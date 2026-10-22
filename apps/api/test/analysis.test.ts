import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { db } from "../src/db";
import { digest, randomToken, sessionCookie } from "../src/security";
import { settings } from "../src/config";
import { dateKey, shiftDay } from "../src/analysis-engine";
import { processAnalysis, analysisTick, analysisView } from "../src/analysis-service";
let app: Awaited<ReturnType<typeof buildApp>>;
const users: string[] = [], properties: string[] = [];
const today = dateKey(new Date(), "America/Cuiaba");
class Client {
  cookie = ""; csrf = "";
  constructor(public userId: string) {}
  async init() {
    const token = randomToken(); await db.session.create({ data: { userId: this.userId, tokenHash: digest(token), expiresAt: new Date(Date.now() + 3600000) } });
    this.cookie = `${sessionCookie}=${token}`;
    const r = await this.get("/api/auth/csrf"); this.csrf = r.json().token;
    this.cookie += r.cookies.map(c => `; ${c.name}=${c.value}`).join(""); return this;
  }
  get(url: string) { return app.inject({ method: "GET", url, headers: { cookie: this.cookie } }); }
  post(url: string, payload: object) { return app.inject({ method: "POST", url, payload, headers: { cookie: this.cookie, origin: settings.origin, "x-csrf-token": this.csrf } }); }
}
let admin: Client, operator: Client, viewer: Client, outsider: Client;
before(async () => {
  app = await buildApp({ test: true });
  const clients: Client[] = [];
  for (const role of ["admin", "operator", "viewer", "outsider"]) {
    const u = await db.user.create({ data: { name: `Análise ${role}`, email: `${randomUUID()}@example.test`, passwordHash: "not-used", emailVerifiedAt: new Date() } });
    users.push(u.id); clients.push(await new Client(u.id).init());
  }
  [admin, operator, viewer, outsider] = clients;
});
after(async () => { await db.property.deleteMany({ where: { id: { in: properties } } }); await db.user.deleteMany({ where: { id: { in: users } } }); await app.close(); await db.$disconnect(); });
async function fixture(expiry?: string) {
  const p = await db.property.create({ data: { name: "Fazenda analítica sintética", responsible: "Teste", timezone: "America/Cuiaba", startMethod: "MANUAL", memberships: { create: [{ userId: admin.userId, role: "ADMIN" }, { userId: operator.userId, role: "OPERATOR" }, { userId: viewer.userId, role: "VIEWER" }] } } });
  properties.push(p.id);
  const product = await db.product.create({ data: { propertyId: p.id, name: "Diesel S10", nameKey: "diesel s10", category: "Combustíveis", unit: "L", minimum: "100", minimumKnown: true, coverageStart: new Date(shiftDay(today, -30)), coverageEnd: new Date(shiftDay(today, -1)), coverageOngoing: true } });
  const lot = await db.stockLot.create({ data: { productId: product.id, code: "D-01", balance: "420", unitCost: "6", expiryStatus: expiry ? "DATED" : "NA", expiresOn: expiry ? new Date(expiry) : null } });
  await db.stockMovement.create({ data: { productId: product.id, lotId: lot.id, kind: "OPENING", delta: "2220", occurredAt: new Date(shiftDay(today, -31) + "T12:00:00Z"), actorId: admin.userId, actorName: "Sintético", source: "WEB", requestKey: randomUUID() } });
  await db.stockMovement.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ productId: product.id, lotId: lot.id, kind: "CONSUMPTION" as const, delta: "-60", occurredAt: new Date(shiftDay(today, -30 + i) + "T12:00:00Z"), actorId: admin.userId, actorName: "Sintético", destination: "Trator", source: "WEB", requestKey: randomUUID() })) });
  return { property: p, product, lot, base: `/api/properties/${p.id}` };
}
test("painel real: idempotência, movimentação, revisão, snapshots, encerramento e recorrência", async () => {
  const f = await fixture();
  let r = await admin.get(f.base + "/analysis"); assert.equal(r.statusCode, 200, r.body);
  const first = r.json(); assert.equal(first.status, "CURRENT"); assert.equal(first.result.products[0].autonomyDays, "7");
  const initialAlert = first.alerts.find((a: any) => a.rule === "SHORTAGE"); assert.ok(initialAlert);
  await Promise.all([processAnalysis(f.property.id), processAnalysis(f.property.id)]);
  assert.equal(await db.analysisSnapshot.count({ where: { propertyId: f.property.id } }), 1);
  async function movement(kind: string, quantity: string) {
    const rev = (await admin.get(f.base + "/inventory")).json().revision;
    const response = await admin.post(f.base + "/movements", { key: randomUUID(), revision: rev, productId: f.product.id, lotId: f.lot.id, kind, quantity, occurredAt: today, destination: "Trator" });
    assert.equal(response.statusCode, 201, response.body); return response.json().id;
  }
  const consumption = await movement("CONSUMPTION", "150");
  r = await admin.get(f.base + "/analysis"); assert.equal(r.json().result.products[0].autonomyDays, "4.5");
  assert.equal((await db.analysisSnapshot.findUniqueOrThrow({ where: { id: first.snapshotId } })).result && (first.result.products[0].autonomyDays), "7");
  const reverse = await admin.post(`${f.base}/movements/${consumption}/reverse`, { key: randomUUID(), revision: (await admin.get(f.base + "/inventory")).json().revision, notes: "Retificar movimento de referência" }); assert.equal(reverse.statusCode, 200, reverse.body);
  assert.equal((await admin.get(f.base + "/analysis")).json().result.products[0].autonomyDays, "7");
  await movement("IN", "5000"); await admin.get(f.base + "/analysis");
  assert.ok((await db.alertOccurrence.findUniqueOrThrow({ where: { id: initialAlert.id } })).closedAt);
  await movement("CONSUMPTION", "5000"); const after = (await admin.get(f.base + "/analysis")).json();
  const recurrence = after.alerts.find((a: any) => a.rule === "SHORTAGE" && !a.closedAt);
  assert.equal(recurrence.previousId, initialAlert.id); assert.notEqual(recurrence.id, initialAlert.id);
  assert.equal(after.result.products[0].autonomyDays, "7");
  assert.equal((await outsider.get(f.base + "/analysis")).statusCode, 404);
  assert.equal((await viewer.get(f.base + "/analysis")).statusCode, 200);
});
test("ações e política: papéis, autor, concorrência e risco independente da ação", async () => {
  const f = await fixture(), v = (await admin.get(f.base + "/analysis")).json(), a = v.alerts[0];
  const body = { version: a.actionVersion, state: "RESOLVED", assigneeId: operator.userId, reason: "Compra planejada, aguardando chegada" };
  assert.equal((await viewer.post(`${f.base}/alerts/${a.id}/action`, body)).statusCode, 403);
  assert.equal((await outsider.post(`${f.base}/alerts/${a.id}/action`, body)).statusCode, 404);
  let r = await operator.post(`${f.base}/alerts/${a.id}/action`, body); assert.equal(r.statusCode, 200, r.body);
  const current = (await admin.get(f.base + "/analysis")).json().alerts.find((x: any) => x.id === a.id);
  assert.equal(current.actionState, "RESOLVED"); assert.equal(current.closedAt, null); assert.equal(current.assigneeId, operator.userId);
  assert.equal((await operator.post(`${f.base}/alerts/${a.id}/action`, body)).statusCode, 409);
  assert.equal((await admin.post(`${f.base}/alerts/${a.id}/action`, { ...body, version: 1, assigneeId: outsider.userId })).statusCode, 400);
  const h = (await viewer.get(`${f.base}/alerts/${a.id}/history`)).json(); assert.equal(h.history.at(-1).actorId, operator.userId); assert.equal(h.history.at(-1).details.after.state, "RESOLVED");
  const policy = { policyVersion: 1, reorderDays: 9, expiryWarningDays: 15, inactivityDays: 90, reason: "Prazo observado no fornecedor" };
  assert.equal((await operator.post(f.base + "/analysis/policy", policy)).statusCode, 403);
  assert.equal((await viewer.post(f.base + "/analysis/policy", policy)).statusCode, 403);
  assert.equal((await admin.post(f.base + "/analysis/policy", policy)).statusCode, 200);
  assert.equal((await admin.post(f.base + "/analysis/policy", policy)).statusCode, 409);
  assert.equal((await admin.get(f.base + "/analysis")).json().result.policy.policyVersion, 2);
});
test("cobertura declarada, falha recuperável e rotina diária sem abrir o painel", async () => {
  const f = await fixture(today);
  let r = await admin.get(f.base + "/analysis"); assert.ok(r.json().alerts.some((a: any) => a.rule === "EXPIRY" && !a.closedAt));
  const revision = r.json().revision;
  const body = { revision, start: shiftDay(today, -10), end: shiftDay(today, -1), ongoing: true, leadTimeDays: null, safetyDays: 0, reason: "Conferência completa dos registros" };
  assert.equal((await viewer.post(`${f.base}/products/${f.product.id}/analysis-settings`, body)).statusCode, 403);
  assert.equal((await operator.post(`${f.base}/products/${f.product.id}/analysis-settings`, { ...body, leadTimeDays: 12 })).statusCode, 403);
  assert.equal((await admin.post(`${f.base}/products/${f.product.id}/analysis-settings`, { ...body, end: shiftDay(today, -3) })).statusCode, 400);
  const coverageResult = await operator.post(`${f.base}/products/${f.product.id}/analysis-settings`, body); assert.equal(coverageResult.statusCode, 200, coverageResult.body);
  r = await admin.get(f.base + "/analysis"); assert.equal(r.json().result.products[0].observedDays, 10);
  // Injeta uma falha somente na propriedade sintética; o estoque não é alterado.
  await db.property.update({ where: { id: f.property.id }, data: { timezone: "Invalid/Zone", analysisPending: true, inventoryRevision: { increment: 1 } } });
  await assert.rejects(() => processAnalysis(f.property.id));
  await db.property.update({ where: { id: f.property.id }, data: { timezone: "America/Cuiaba" } });
  assert.equal((await analysisView(f.property.id)).status, "ERROR");
  await analysisTick(new Date(Date.now() + 61000), [f.property.id]);
  assert.equal((await analysisView(f.property.id)).status, "CURRENT");
  const tomorrow = new Date(shiftDay(today, 1) + "T12:00:00Z");
  await analysisTick(tomorrow, [f.property.id]);
  const alerts = await db.alertOccurrence.findMany({ where: { propertyId: f.property.id } });
  assert.ok(alerts.some(a => a.rule === "EXPIRED" && !a.closedAt)); assert.ok(alerts.some(a => a.rule === "EXPIRY" && a.closedAt));
  assert.equal((await db.stockLot.findUniqueOrThrow({ where: { id: f.lot.id } })).balance.toString(), "420");
});
test("origem histórica, mínimo ausente e saída genérica revisável na importação", async () => {
  const f = await fixture();
  const csv = `Produto;Unidade;Quantidade;Tipo;Data;Lote;Destino;Responsavel;Referencia\nDiesel S10;L;5;saida;${today};D-01;Trator;Pessoa original;REG-17`;
  let r = await admin.post(f.base + "/imports", { fileName: "origem.csv", content: Buffer.from(csv).toString("base64"), mode: "HISTORY" });
  assert.equal(r.statusCode, 201, r.body); const id = r.json().id;
  r = await admin.post(`${f.base}/imports/${id}/preview`, { sheet: 0, mapping: { product: 0, unit: 1, quantity: 2, kind: 3, date: 4, lot: 5, destination: 6, responsible: 7, reference: 8 }, locale: "BR", positionDate: today, edits: [] });
  assert.equal(r.statusCode, 200, r.body); const preview = r.json();
  assert.ok(preview.rows[0].warnings.some((w: string) => w.includes("Saída genérica")));
  r = await admin.post(`${f.base}/imports/${id}/confirm`, { previewToken: preview.previewToken, lines: [2], acknowledgeWarnings: true, allowDuplicates: false });
  assert.equal(r.statusCode, 200, r.body);
  const m = await db.stockMovement.findFirstOrThrow({ where: { importBatchId: id } });
  assert.equal(m.originalResponsible, "Pessoa original"); assert.equal(m.actorId, admin.userId); assert.equal(m.originalLine, 2); assert.equal(m.originalReference, "REG-17"); assert.equal(m.consumptionConfirmed, false);
  assert.equal((await viewer.post(`${f.base}/movements/${m.id}/classify`, { reason: "Conferido" })).statusCode, 403);
  assert.equal((await operator.post(`${f.base}/movements/${m.id}/classify`, { reason: "Destino confirmado no registro" })).statusCode, 200);
  assert.equal((await db.stockMovement.findUniqueOrThrow({ where: { id: m.id } })).consumptionConfirmed, true);
});
test("limite geral isola sessões válidas no mesmo proxy e mantém bloqueio por sessão", async () => {
  const a = await new Client(admin.userId).init(), b = await new Client(operator.userId).init();
  // A consulta CSRF já contou como a primeira requisição de cada sessão.
  for (let i = 0; i < 179; i++) assert.equal((await a.get("/api/health")).statusCode, 200);
  assert.equal((await a.get("/api/health")).statusCode, 429);
  assert.equal((await b.get("/api/health")).statusCode, 200);
});

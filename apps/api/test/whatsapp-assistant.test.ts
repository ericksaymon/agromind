import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { db } from "../src/db";
import { digest, sessionCookie } from "../src/security";
import { settings } from "../src/config";
import { encryptWhatsapp, decryptWhatsapp } from "../src/whatsapp-crypto";
import { processWhatsappEvent, sendWhatsappReply, metaSend } from "../src/whatsapp-service";
import { processAnalysis } from "../src/analysis-service";
const prefix = `assistant-${Date.now()}`, users: string[] = [], properties: string[] = [], events: string[] = [];
const envNames = ["WHATSAPP_INBOX_KEY", "WHATSAPP_PUBLIC_NUMBER", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_GRAPH_VERSION"];
const previous = envNames.map(k => process.env[k]);
let app: Awaited<ReturnType<typeof buildApp>>;
before(async () => { process.env.WHATSAPP_INBOX_KEY = randomBytes(32).toString("hex"); process.env.WHATSAPP_PUBLIC_NUMBER = "556900000000"; app = await buildApp({ test: true }); });
after(async () => {
  await app.close();
  await db.whatsappReply.deleteMany({ where: { eventKey: { in: events } } });
  await db.whatsappInboxEvent.deleteMany({ where: { eventKey: { in: events } } });
  await db.property.deleteMany({ where: { id: { in: properties } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
  envNames.forEach((k, i) => { if (previous[i] === undefined) delete process.env[k]; else process.env[k] = previous[i]; });
});
async function fixture(role: "ADMIN" | "VIEWER" = "VIEWER") {
  const user = await db.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Pessoa sintética", passwordHash: "test", emailVerifiedAt: new Date() } }); users.push(user.id);
  const p = await db.property.create({ data: { name: "Propriedade sintética", responsible: "Teste", timezone: "America/Cuiaba", startMethod: "MANUAL", memberships: { create: { userId: user.id, role } } } }); properties.push(p.id);
  const token = randomBytes(32).toString("hex");
  const session = await db.session.create({ data: { userId: user.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 86400000) } });
  const csrf = await app.inject({ url: "/api/auth/csrf", headers: { cookie: `${sessionCookie}=${token}` } });
  const headers = { cookie: `${sessionCookie}=${token}; ${csrf.cookies.map(c => `${c.name}=${c.value}`).join("; ")}`, origin: settings.origin, "x-csrf-token": csrf.json().token };
  const post = (url: string, body: object = {}) => app.inject({ method: "POST", url, headers, payload: body });
  const code = async () => { const r = await post("/api/account/whatsapp/code", { propertyId: p.id }); assert.equal(r.statusCode, 200, r.body); return r.json().message as string; };
  return { user, p, session, headers, post, code, phone: `5569${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}` };
}
async function message(phone: string, body: string, extra: object = {}, kind = "message") {
  const eventKey = digest(randomUUID()); events.push(eventKey);
  await db.whatsappInboxEvent.create({ data: { eventKey, accountId: prefix, phoneNumberId: "synthetic", kind, encrypted: encryptWhatsapp({ id: eventKey, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body }, ...extra }) } });
  return eventKey;
}
async function receive(phone: string, text: string, extra: object = {}) {
  const key = await message(phone, text, extra);
  assert.equal(await processWhatsappEvent(key), true);
  return db.whatsappReply.findUnique({ where: { eventKey: key } });
}
const response = (r: { encrypted: string } | null) => { assert.ok(r); return decryptWhatsapp<{ to: string; text: string }>(r.encrypted).text; };

test("assistente: código com hash, geração invalida anterior, escopo e CSRF", async () => {
  const a = await fixture(), b = await fixture();
  const first = await a.code(), second = await a.code();
  assert.notEqual(first, second);
  const old = await db.whatsappPairCode.findUniqueOrThrow({ where: { hash: digest(first.split(" ")[1]) } }); assert.ok(old.usedAt);
  assert.equal((await a.post("/api/account/whatsapp/code", { propertyId: b.p.id })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: "/api/account/whatsapp/code", payload: { propertyId: a.p.id } })).statusCode, 403);
  assert.equal((await app.inject({ url: "/api/account/whatsapp" })).statusCode, 401);
});
test("assistente: VIEWER vincula com código único, concorrência e replay não duplicam vínculo/resposta", async () => {
  const a = await fixture(); const code = await a.code(), key = await message(a.phone, code);
  await Promise.all([processWhatsappEvent(key), processWhatsappEvent(key)]);
  assert.equal(await db.whatsappConnection.count({ where: { userId: a.user.id } }), 1);
  assert.equal(await db.whatsappReply.count({ where: { eventKey: key } }), 1);
  assert.match(response(await db.whatsappReply.findUnique({ where: { eventKey: key } })), /conectado/);
  assert.match(response(await receive(a.phone, code)), /inválido|indisponível/);
  const state = await app.inject({ url: "/api/account/whatsapp", headers: a.headers }); assert.equal(state.json().connection.lastDigits, a.phone.slice(-4)); assert.equal(JSON.stringify(state.json()).includes(a.phone), false);
});
test("assistente: código expirado, sessão revogada e telefone de outro titular são recusados", async () => {
  const a = await fixture(), b = await fixture();
  const code = await a.code();
  await db.whatsappPairCode.update({ where: { hash: digest(code.split(" ")[1]) }, data: { expiresAt: new Date(0) } });
  assert.match(response(await receive(a.phone, code)), /inválido|indisponível/);
  await receive(a.phone, await a.code());
  assert.match(response(await receive(a.phone, await b.code())), /inválido|indisponível/);
  const valid = await b.code(); await db.session.delete({ where: { id: b.session.id } });
  assert.match(response(await receive(b.phone, valid)), /inválido|expirado/);
  assert.equal(await db.whatsappConnection.count({ where: { userId: b.user.id } }), 0);
});
test("assistente: saldo real, isolamento, validade, ambiguidade e ausência de histórico", async () => {
  const a = await fixture(); await receive(a.phone, await a.code());
  const category = await db.category.findFirstOrThrow({ where: { propertyId: a.p.id, nameKey: "combustiveis" } });
  const p = await db.product.create({ data: { propertyId: a.p.id, name: "Diesel S10", nameKey: "diesel s10", category: category.name, categoryId: category.id, unit: "L", minimum: "60", minimumKnown: true, lots: { create: [{ code: "A", balance: "40.5", expiryStatus: "NA" }, { code: "B", balance: "5", expiryStatus: "DATED", expiresOn: new Date("2000-01-01") }] } } });
  assert.match(response(await receive(a.phone, "Quanto diesel temos?")), /Saldo físico: 45.5 L/);
  assert.match(response(await receive(a.phone, "O que está perto de vencer?")), /vencido/);
  await processAnalysis(a.p.id);
  assert.match(response(await receive(a.phone, "O que está abaixo do mínimo?")), /Diesel S10/);
  assert.match(response(await receive(a.phone, "Qual a autonomia do diesel?")), /histórico suficiente/);
  await db.product.create({ data: { propertyId: a.p.id, name: "Diesel S500", nameKey: "diesel s500", category: category.name, categoryId: category.id, unit: "L" } });
  assert.match(response(await receive(a.phone, "Quanto diesel temos?")), /mais de um/);
  assert.match(response(await receive(a.phone, "Retire 20 litros de diesel")), /nenhuma alteração/);
  assert.equal(await db.stockMovement.count({ where: { productId: p.id } }), 0);
  assert.match(response(await receive(a.phone, "consulta", { type: "audio" })), /por texto/);
  const stranger = await receive("556900000099", "Quanto diesel temos?"); assert.ok(!response(stranger).includes("45.5"));
});
test("assistente: revogação cancela resposta já calculada antes de transmitir dados", async () => {
  const a = await fixture(); await receive(a.phone, await a.code());
  const reply = await receive(a.phone, "Olá"); assert.ok(reply);
  await db.membership.delete({ where: { userId_propertyId: { userId: a.user.id, propertyId: a.p.id } } });
  let calls = 0; await sendWhatsappReply(async () => { calls++; return randomUUID(); }, reply.id);
  assert.equal(calls, 0); assert.equal((await db.whatsappReply.findUniqueOrThrow({ where: { id: reply.id } })).status, "CANCELED");
  assert.match(response(await receive(a.phone, "Quanto diesel temos?")), /Conectar WhatsApp/);
});
test("assistente: desconectar invalida códigos e respostas pendentes; reconexão muda versão", async () => {
  const a = await fixture(); await receive(a.phone, await a.code());
  const old = await receive(a.phone, "Olá"); assert.ok(old);
  await receive(a.phone, await a.code());
  let calls = 0; await sendWhatsappReply(async () => { calls++; return randomUUID(); }, old.id); assert.equal(calls, 0);
  const code = await a.code();
  assert.equal((await a.post("/api/account/whatsapp/disconnect")).statusCode, 200);
  assert.equal(await db.whatsappConnection.count({ where: { userId: a.user.id } }), 0);
  assert.match(response(await receive(a.phone, code)), /inválido|indisponível/);
});
test("assistente: falha ambígua não reenvia; eventos de entrega não regridem", async () => {
  const a = await fixture(); await receive(a.phone, await a.code());
  const r = await receive(a.phone, "Olá"); assert.ok(r);
  let calls = 0;
  const timeout = async () => { calls++; throw new Error("timeout"); };
  await sendWhatsappReply(timeout, r.id); await sendWhatsappReply(timeout, r.id);
  assert.equal(calls, 1); assert.equal((await db.whatsappReply.findUniqueOrThrow({ where: { id: r.id } })).status, "UNKNOWN");
  const sent = await receive(a.phone, "ajuda"); assert.ok(sent);
  const externalId = randomUUID(); await sendWhatsappReply(async () => externalId, sent.id);
  for (const status of ["read", "sent"]) { const key = await message(a.phone, "", { id: externalId, status }, "status"); await processWhatsappEvent(key); }
  assert.equal((await db.whatsappReply.findUniqueOrThrow({ where: { id: sent.id } })).status, "READ");
});
test("assistente: evento antigo não responde; conteúdo indecifrável tem tentativas limitadas", async () => {
  const key = await message("556900000088", "Olá", { timestamp: "1" }); await processWhatsappEvent(key);
  assert.equal(await db.whatsappReply.count({ where: { eventKey: key } }), 0);
  const broken = await message("556900000077", "Olá"); await db.whatsappInboxEvent.update({ where: { eventKey: broken }, data: { encrypted: "broken" } });
  for (let i = 0; i < 7; i++) await processWhatsappEvent(broken);
  assert.equal((await db.whatsappInboxEvent.findUniqueOrThrow({ where: { eventKey: broken } })).attempts, 5);
});
test("assistente: limite de respostas por remetente", async () => {
  const phone = "556900000066";
  for (let i = 0; i < 11; i++) await receive(phone, "Olá");
  const { phoneHash } = await import("../src/whatsapp-crypto");
  assert.equal(await db.whatsappReply.count({ where: { recipientHash: phoneHash(phone) } }), 10);
});
test("assistente: adaptador envia texto com janela do provedor e classifica rejeição", async () => {
  const fetchOriginal = globalThis.fetch;
  process.env.WHATSAPP_ACCESS_TOKEN = "synthetic-token"; process.env.WHATSAPP_GRAPH_VERSION = "v26.0";
  const oldPhone = process.env.WHATSAPP_PHONE_NUMBER_ID; process.env.WHATSAPP_PHONE_NUMBER_ID = "synthetic-phone";
  try {
    globalThis.fetch = (async (url: string, options: RequestInit) => { assert.match(url, /v26.0\/synthetic-phone\/messages$/); const body = JSON.parse(options.body as string); assert.equal(body.to, "556900000055"); assert.equal(body.text.body, "Teste"); return new Response(JSON.stringify({ messages: [{ id: "sent-id" }] })); }) as typeof fetch;
    assert.equal(await metaSend("556900000055", "Teste"), "sent-id");
    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await assert.rejects(metaSend("556900000055", "Teste"), e => (e as { definite: boolean }).definite);
  } finally { globalThis.fetch = fetchOriginal; if (oldPhone === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID; else process.env.WHATSAPP_PHONE_NUMBER_ID = oldPhone; }
});

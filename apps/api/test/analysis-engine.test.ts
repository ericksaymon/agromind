import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "../src/generated/prisma/client";
import { calculateAnalysis, shiftDay, type AnalysisInput } from "../src/analysis-engine";
const today = "2026-10-22", zone = "America/Cuiaba";
const policy = { reorderDays: 7, expiryWarningDays: 30, inactivityDays: 90, policyVersion: 1 };
const d = (v: number | string) => new Prisma.Decimal(v);
function fixture(days = 30, daily = 60, balance = 420): AnalysisInput {
  const id = randomUUID(), lotId = randomUUID();
  return { id, propertyId: randomUUID(), name: "Diesel S10", nameKey: "diesel s10", category: "Combustíveis", unit: "L", minimum: d(100), minimumKnown: true, archived: false, createdAt: new Date(), updatedAt: new Date(), coverageStart: new Date(shiftDay(today, -days)), coverageEnd: new Date(shiftDay(today, -1)), coverageOngoing: true, coverageConfirmedBy: randomUUID(), leadTimeDays: null, safetyDays: 0, positionOn: null,
    lots: [{ id: lotId, productId: id, code: "D-01", balance: d(balance), unitCost: d(6), expiryStatus: "NA", expiresOn: null, supplier: null, createdAt: new Date("2026-01-01") }],
    movements: Array.from({ length: days }, (_, i) => ({ id: randomUUID(), sequence: BigInt(i + 1), productId: id, lotId, kind: "CONSUMPTION" as const, delta: d(-daily), unitCost: d(6), occurredAt: new Date(shiftDay(today, -days + i) + "T12:00:00Z"), recordedAt: new Date(), actorId: randomUUID(), actorName: "Sintético", originalResponsible: null, originalReference: null, originalLine: null, consumptionConfirmed: true, destination: "Trator", notes: null, source: "WEB", requestKey: randomUUID(), reversalOf: null, importBatchId: null, fingerprint: null })) };
}
const calc = (...p: AnalysisInput[]) => calculateAnalysis(p, today, zone, 3, policy);
test("média por dias corridos: 420/60=7; retirada atual altera autonomia para 4,5 sem inflar a média", () => {
  const p = fixture();
  const first = calc(p).products[0];
  assert.equal(first.dailyAverage, "60"); assert.equal(first.autonomyDays, "7"); assert.equal(first.observedDays, 30);
  p.lots[0].balance = d(270);
  p.movements.push({ ...p.movements[0], id: randomUUID(), delta: d(-150), occurredAt: new Date(today + "T14:00:00Z") });
  assert.equal(calc(p).products[0].autonomyDays, "4.5"); assert.equal(calc(p).products[0].dailyAverage, "60");
  p.movements = p.movements.slice(0, 1);
  assert.equal(calc(p).products[0].dailyAverage, "2"); // 29 dias cobertos sem uso contam como zero.
});
test("sem cobertura, cobertura incompleta, pouco histórico e consumo zero não produzem previsão", () => {
  const p = fixture(); p.coverageStart = null; p.coverageEnd = null; p.coverageOngoing = false;
  assert.equal(calc(p).products[0].autonomyDays, null);
  const short = fixture(6); assert.equal(calc(short).products[0].autonomyDays, null);
  const partial = fixture(7); assert.equal(calc(partial).products[0].preliminary, true); assert.equal(calc(partial).products[0].dailyAverage, "60");
  partial.coverageOngoing = false; partial.coverageEnd = new Date(shiftDay(today, -2)); assert.equal(calc(partial).products[0].dailyAverage, null);
  const zero = fixture(30, 0); assert.equal(calc(zero).products[0].autonomyDays, null); assert.ok(!calc(zero).alerts.some(a => a.rule === "SHORTAGE"));
});
test("descarte, ajuste, saída genérica e consumo estornado não entram na média", () => {
  const p = fixture(); p.movements = p.movements.slice(0, 5);
  p.movements[0].kind = "DISPOSAL"; p.movements[1].kind = "ADJUST_OUT"; p.movements[2].consumptionConfirmed = false;
  p.movements.push({ ...p.movements[3], id: randomUUID(), kind: "REVERSAL", delta: d(60), reversalOf: p.movements[3].id });
  assert.equal(calc(p).products[0].consumption, "60"); assert.equal(calc(p).products[0].dailyAverage, "2");
});
test("validade desconhecida e vencida ficam fora da autonomia; lote zerado não alerta", () => {
  const p = fixture(); const base = p.lots[0];
  p.lots.push({ ...base, id: randomUUID(), code: "VENCIDO", balance: d(100), expiryStatus: "DATED", expiresOn: new Date("2026-10-21") }, { ...base, id: randomUUID(), code: "DESCONHECIDO", balance: d(50), expiryStatus: "UNKNOWN" }, { ...base, id: randomUUID(), code: "ZERO", balance: d(0), expiryStatus: "DATED", expiresOn: new Date(today) });
  const r = calc(p); assert.equal(r.products[0].physical, "570"); assert.equal(r.products[0].eligible, "420"); assert.equal(r.products[0].autonomyDays, "7");
  assert.equal(r.alerts[0].rule, "EXPIRED"); assert.ok(!r.alerts.some(a => a.lotCode === "ZERO")); assert.equal(r.summary.criticalProducts, 1);
});
test("FEFO distribui uma única demanda e valor exposto não duplica lotes entre regras", () => {
  const p = fixture(30, 10, 40);
  p.lots[0].expiryStatus = "DATED"; p.lots[0].expiresOn = new Date("2026-10-24"); p.lots[0].unitCost = d(2);
  p.lots.push({ ...p.lots[0], id: randomUUID(), code: "D-02" });
  const r = calc(p), losses = r.alerts.filter(a => a.rule === "EXPIRY_LOSS");
  assert.deepEqual(losses.map(a => a.exposedQuantity).sort(), ["10", "40"]);
  assert.equal(r.summary.knownRiskValue, "160.00"); assert.equal(r.summary.knownValue, "160.00"); assert.equal(r.summary.expiringLots, 2);
  p.lots[1].unitCost = null; assert.equal(calc(p).summary.knownRiskValue, "80.00"); assert.equal(calc(p).summary.unpricedLots, 1);
});
test("baixo movimento exige 90 dias cobertos; mínimo desconhecido não vira normalidade e arquivado não conta", () => {
  const p = fixture(90, 0); p.movements = []; p.minimumKnown = false;
  assert.ok(calc(p).alerts.some(a => a.rule === "NO_CONSUMPTION")); assert.ok(calc(p).products[0].limitations.some(l => l.includes("mínimo")));
  p.coverageStart = new Date(shiftDay(today, -89)); assert.ok(!calc(p).alerts.some(a => a.rule === "NO_CONSUMPTION"));
  p.archived = true; assert.equal(calc(p).summary.products, 0); assert.equal(calc(p).summary.knownValue, "0.00");
});
test("fuso local define os dias, variabilidade é sinalizada e as prioridades são determinísticas", () => {
  const p = fixture(); p.movements = [{ ...p.movements[0], occurredAt: new Date("2026-10-22T01:00:00Z"), delta: d(-1800) }];
  const r = calc(p); assert.equal(r.products[0].dailyAverage, "60"); assert.equal(r.products[0].daily.at(-1)?.quantity, "1800"); assert.equal(r.products[0].unstable, true);
  assert.deepEqual(r, calc(p));
});

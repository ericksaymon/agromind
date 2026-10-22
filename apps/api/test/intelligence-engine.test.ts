import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "../src/generated/prisma/client";
import { calculateAnalysis, type AnalysisInput } from "../src/analysis-engine";
import { shiftDay } from "../src/analysis-common";
import { projectInventory } from "../src/intelligence-projection";
import {
  defaultIntelligencePolicy,
  type AnalysisPolicy,
} from "../../../packages/contracts/src/index";
const today = "2026-10-22",
  zone = "America/Cuiaba",
  D = (v: number | string) => new Prisma.Decimal(v);
const policy: AnalysisPolicy = {
  reorderDays: 7,
  expiryWarningDays: 30,
  inactivityDays: 90,
  policyVersion: 1,
  intelligence: { ...defaultIntelligencePolicy },
};
function fixture(days = 100, daily = 10, balance = 420): AnalysisInput {
  const id = randomUUID(),
    lotId = randomUUID();
  return {
    id,
    propertyId: randomUUID(),
    name: "Diesel S10",
    nameKey: "diesel s10",
    category: "Combustíveis",
    unit: "L",
    minimum: D(100),
    minimumKnown: true,
    archived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    coverageStart: new Date(shiftDay(today, -days)),
    coverageEnd: new Date(shiftDay(today, -1)),
    coverageOngoing: true,
    coverageConfirmedBy: randomUUID(),
    leadTimeDays: null,
    safetyDays: 0,
    positionOn: null,
    lots: [
      {
        id: lotId,
        productId: id,
        code: "D-01",
        balance: D(balance),
        unitCost: D(5),
        expiryStatus: "NA",
        expiresOn: null,
        supplier: "Fornecedor sintético",
        createdAt: new Date("2026-01-01"),
      },
    ],
    movements: Array.from({ length: days }, (_, i) => ({
      id: randomUUID(),
      sequence: BigInt(i + 1),
      productId: id,
      lotId,
      kind: "CONSUMPTION" as const,
      delta: D(-daily),
      unitCost: D(5),
      occurredAt: new Date(shiftDay(today, -days + i) + "T12:00:00Z"),
      recordedAt: new Date(),
      actorId: randomUUID(),
      actorName: "Teste",
      originalResponsible: null,
      originalReference: null,
      originalLine: null,
      consumptionConfirmed: true,
      destination: "Trator",
      notes: null,
      source: "WEB",
      requestKey: randomUUID(),
      reversalOf: null,
      importBatchId: null,
      fingerprint: null,
    })),
  };
}
const calc = (p: AnalysisInput[], pol = policy, options = {}) =>
  calculateAnalysis(p, today, zone, 2, pol, options);
test("períodos completos e equivalentes: aumento de 100%, lacunas e base zero explícitos", () => {
  const p = fixture();
  p.movements.slice(-30).forEach((m) => {
    m.delta = D(-20);
  });
  let r = calc([p]);
  assert.equal(r.intelligence!.products[0].changePercent, "100");
  assert.ok(r.alerts.some((a) => a.rule === "CONSUMPTION_CHANGE"));
  p.coverageStart = new Date(shiftDay(today, -30));
  r = calc([p]);
  assert.equal(r.intelligence!.products[0].comparisonStatus, "INSUFFICIENT");
  assert.equal(r.intelligence!.products[0].changePercent, null);
  assert.ok(!r.alerts.some((a) => a.rule === "CONSUMPTION_CHANGE"));
  p.coverageStart = new Date(shiftDay(today, -100));
  p.movements = p.movements.slice(-30);
  r = calc([p]);
  assert.equal(r.intelligence!.products[0].comparisonStatus, "STARTED");
  assert.equal(r.intelligence!.products[0].changePercent, null);
});
test("agrupamentos não fabricam zeros fora da cobertura e recortam semanas/meses", () => {
  const p = fixture();
  p.coverageStart = new Date("2026-10-05");
  let r = calc([p], policy, {
    from: "2026-10-01",
    to: "2026-10-21",
    grouping: "WEEK",
  });
  assert.equal(r.intelligence!.products[0].series.length, 3);
  assert.equal(r.intelligence!.products[0].series[0].quantity, null);
  assert.equal(r.intelligence!.products[0].series[0].coveredDays, 3);
  r = calc([p], policy, {
    from: "2026-09-25",
    to: "2026-10-21",
    grouping: "MONTH",
  });
  assert.equal(r.intelligence!.products[0].series[0].to, "2026-09-30");
  assert.equal(r.intelligence!.products[0].series[1].to, "2026-10-21");
});
test("tendência exige dois crescimentos semanais; um pico isolado não basta", () => {
  const p = fixture();
  p.movements.slice(-21, -14).forEach((m) => {
    m.delta = D(-10);
  });
  p.movements.slice(-14, -7).forEach((m) => {
    m.delta = D(-15);
  });
  p.movements.slice(-7).forEach((m) => {
    m.delta = D(-25);
  });
  assert.ok(calc([p]).alerts.some((a) => a.rule === "CONSUMPTION_TREND"));
  p.movements.slice(-21).forEach((m) => {
    m.delta = D(-10);
  });
  p.movements.at(-1)!.delta = D(-1000);
  assert.ok(!calc([p]).alerts.some((a) => a.rule === "CONSUMPTION_TREND"));
});
test("retirada incomum compara apenas eventos anteriores e respeita amostra mínima e estorno", () => {
  const p = fixture(),
    event = {
      ...p.movements.at(-1)!,
      id: randomUUID(),
      sequence: 1000n,
      delta: D(-100),
      occurredAt: new Date(today + "T12:00:00Z"),
    };
  p.movements.push(event);
  let r = calc([p]);
  const unusual = r.intelligence!.anomalies.find(
    (a) => a.movementId === event.id,
  )!;
  assert.equal(unusual.median, "10");
  assert.equal(unusual.threshold, "30");
  assert.equal(unusual.samples, 30);
  assert.ok(r.alerts.some((a) => a.identity.endsWith(event.id)));
  p.movements.push({
    ...event,
    id: randomUUID(),
    kind: "REVERSAL",
    delta: D(100),
    reversalOf: event.id,
  });
  assert.ok(
    !calc([p]).intelligence!.anomalies.some((a) => a.movementId === event.id),
  );
  p.movements = [p.movements[0], event];
  assert.equal(calc([p]).intelligence!.anomalies.length, 0);
});
test("compras 5→6 variam 20%, sem reprecificar lotes; abertura/ajuste não são aquisição", () => {
  const p = fixture();
  p.lots[0].balance = D(100);
  const l2 = {
    ...p.lots[0],
    id: randomUUID(),
    code: "D-02",
    balance: D(100),
    unitCost: D(6),
  };
  p.lots.push(l2);
  const template = p.movements[0];
  p.movements.push(
    {
      ...template,
      id: randomUUID(),
      sequence: 1001n,
      kind: "IN",
      delta: D(100),
      unitCost: D(5),
      occurredAt: new Date("2026-10-01T12:00:00Z"),
    },
    {
      ...template,
      id: randomUUID(),
      sequence: 1002n,
      lotId: l2.id,
      kind: "IN",
      delta: D(100),
      unitCost: D(6),
      occurredAt: new Date("2026-10-02T12:00:00Z"),
    },
    {
      ...template,
      id: randomUUID(),
      sequence: 1003n,
      kind: "OPENING",
      delta: D(1000),
      unitCost: D(99),
      occurredAt: new Date("2026-10-03T12:00:00Z"),
    },
  );
  const r = calc([p]),
    metric = r.intelligence!.products[0];
  assert.equal(r.summary.knownValue, "1100.00");
  assert.equal(metric.weightedCost, "5.5");
  assert.equal(metric.priceChangePercent, "20");
  assert.equal(metric.purchaseValue, "1100.00");
  assert.ok(r.alerts.some((a) => a.rule === "PRICE_CHANGE"));
  const historical = calc([p], policy, { from: "2026-09-25", to: "2026-10-01" })
    .intelligence!.products[0];
  assert.equal(historical.priceStatus, "INSUFFICIENT");
  assert.equal(historical.priceChangePercent, null);
});
test("custo ausente, base de preço zero e arquivado preservam significados financeiros", () => {
  const p = fixture();
  const template = p.movements.at(-1)!;
  p.movements.push(
    {
      ...template,
      id: randomUUID(),
      sequence: 1001n,
      kind: "IN",
      delta: D(10),
      unitCost: D(0),
      occurredAt: new Date("2026-10-01T12:00:00Z"),
    },
    {
      ...template,
      id: randomUUID(),
      sequence: 1002n,
      kind: "IN",
      delta: D(10),
      unitCost: D(6),
      occurredAt: new Date("2026-10-02T12:00:00Z"),
    },
    {
      ...template,
      id: randomUUID(),
      sequence: 1003n,
      kind: "IN",
      delta: D(10),
      unitCost: null,
      occurredAt: new Date("2026-10-03T12:00:00Z"),
    },
  );
  p.archived = true;
  const r = calc([p]);
  assert.equal(r.summary.knownValue, "0.00");
  assert.equal(r.intelligence!.summary.purchaseValue, "60.00");
  assert.equal(r.intelligence!.summary.purchaseUnpriced, 1);
  assert.equal(r.intelligence!.products[0].priceStatus, "ZERO_BASE");
  assert.equal(r.intelligence!.products[0].planning.suggestedQuantity, null);
});
test("excesso e parado usam união por lote e saldo desconhecido não vira disponibilidade", () => {
  const p = fixture(100, 10, 2000);
  p.movements = p.movements.filter(
    (m) => m.occurredAt.toISOString().slice(0, 10) < "2026-10-15",
  );
  const pol = {
    ...policy,
    inactivityDays: 7,
    intelligence: { ...defaultIntelligencePolicy, excessDays: 7 },
  };
  const r = calc([p], pol).intelligence!;
  assert.equal(r.products[0].idle, true);
  assert.ok(Number(r.products[0].excessQuantity) > 0);
  assert.equal(r.summary.idleKnownValue, "10000.00");
  assert.equal(r.summary.exposureKnownValue, "10000.00");
  assert.ok(
    Number(r.summary.excessKnownValue) < Number(r.summary.exposureKnownValue),
  );
  p.lots[0].expiryStatus = "UNKNOWN";
  const unknown = calc([p], pol).intelligence!;
  assert.equal(unknown.products[0].excessQuantity, "0");
  assert.equal(unknown.products[0].idleKnownValue, "10000.00");
});
test("compra sugerida usa máximo entre mínimo e demanda, e arredonda un para cima", () => {
  const p = fixture(30, 10, 50);
  p.minimum = D(100);
  let r = calc([p], policy, { horizonDays: 10 }).intelligence!.products[0];
  assert.equal(r.planning.targetQuantity, "100");
  assert.equal(r.planning.suggestedQuantity, "50");
  p.coverageStart = null;
  p.coverageEnd = null;
  p.coverageOngoing = false;
  r = calc([p]).intelligence!.products[0];
  assert.equal(r.planning.basis, "MINIMUM_ONLY");
  assert.equal(r.planning.suggestedQuantity, "50");
  p.minimumKnown = false;
  assert.equal(
    calc([p]).intelligence!.products[0].planning.suggestedQuantity,
    null,
  );
  p.minimumKnown = true;
  p.minimum = D(0);
  assert.equal(calc([p]).intelligence!.products[0].planning.suggestedQuantity, null);
  const units = fixture(30, 1, 0);
  units.unit = "un";
  units.minimum = D(0);
  units.movements = units.movements.slice(0, 1);
  assert.equal(
    calc([units], policy, { horizonDays: 10 }).intelligence!.products[0]
      .planning.suggestedQuantity,
    "1",
  );
});
test("projeção FEFO: vencimento, chegada tardia, demanda não acumulada e consumo zero", () => {
  const p = fixture(30, 10, 20);
  const baseline = projectInventory(p.lots, D(10), today, 5);
  assert.equal(baseline.firstShortageDay, "2026-10-24");
  assert.equal(baseline.unmetQuantity, "30");
  const scenario = projectInventory(p.lots, D(10), today, 5, {
    quantity: "100",
    day: "2026-10-25",
    expiryStatus: "NA",
  });
  assert.equal(scenario.unmetBeforeArrival, "10");
  assert.equal(scenario.closingBalance, "80");
  assert.equal(p.lots[0].balance.toString(), "20");
  p.lots[0].expiresOn = new Date(today);
  p.lots[0].expiryStatus = "DATED";
  const zero = projectInventory(p.lots, D(0), today, 3);
  assert.equal(zero.expiredQuantity, "20");
  assert.equal(zero.shortageDays, 0);
  assert.equal(zero.firstShortageDay, null);
  const unknown = projectInventory([], D(10), today, 2, {
    quantity: "100",
    day: today,
    expiryStatus: "UNKNOWN",
  });
  assert.equal(unknown.unmetQuantity, "20");
});

test("consolidados financeiros arredondam somente após a soma, sem perder frações de centavo", () => {
  const products = [fixture(30, 1, 1), fixture(30, 1, 1)];
  for (const p of products) {
    p.lots[0].balance = D("0.5");
    p.lots[0].unitCost = D("0.005");
    const template = p.movements[0];
    p.movements = [
      {
        ...template,
        id: randomUUID(),
        kind: "IN",
        delta: D(1),
        unitCost: D("0.005"),
        occurredAt: new Date("2026-10-01T12:00:00Z"),
      },
      {
        ...template,
        id: randomUUID(),
        kind: "CONSUMPTION",
        delta: D("-0.5"),
        unitCost: D("0.005"),
        occurredAt: new Date("2026-10-02T12:00:00Z"),
      },
    ];
  }
  const r = calc(products);
  assert.equal(r.summary.knownValue, "0.01");
  assert.equal(r.intelligence!.summary.currentValue, "0.01");
  assert.equal(r.intelligence!.summary.purchaseValue, "0.01");
  assert.equal(r.intelligence!.summary.consumptionValue, "0.01");
  assert.equal(r.intelligence!.categories[0].currentValue, "0.01");
  assert.equal(r.intelligence!.products[0].knownValueShare, "50");
});

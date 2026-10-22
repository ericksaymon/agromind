import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { demoFixture } from "../src/demo-fixture";
import { calculateAnalysis } from "../src/analysis-engine";
import { defaultIntelligencePolicy } from "../../../packages/contracts/src/index";
test("base demonstrativa concilia cada lote e apresenta riscos calculáveis e dados ausentes", () => {
  const products = demoFixture(randomUUID(), randomUUID(), "2026-10-22");
  for (const p of products)
    for (const l of p.lots) {
      const balance = p.movements
        .filter((m) => m.lotId === l.id)
        .reduce((sum, m) => sum.plus(m.delta), l.balance.mul(0));
      assert.ok(balance.eq(l.balance), `${p.name} ${l.code}`);
    }
  const r = calculateAnalysis(products, "2026-10-22", "America/Cuiaba", 1, {
    policyVersion: 1,
    reorderDays: 7,
    expiryWarningDays: 30,
    inactivityDays: 90,
    intelligence: { ...defaultIntelligencePolicy },
  });
  assert.equal(
    r.products.find((p) => p.name === "Diesel S10")!.autonomyDays,
    "7",
  );
  assert.equal(r.summary.knownValue, "11960.00");
  for (const rule of [
    "MINIMUM",
    "SHORTAGE",
    "EXPIRY",
    "EXPIRY_LOSS",
    "EXCESS",
    "HIGH_VALUE_IDLE",
    "PRICE_CHANGE",
  ])
    assert.ok(
      r.alerts.some((a) => a.rule === rule),
      rule,
    );
  const unknown = r.products.find((p) => p.name === "Semente sem referência")!;
  assert.equal(unknown.dailyAverage, null);
  assert.equal(unknown.minimumKnown, false);
});

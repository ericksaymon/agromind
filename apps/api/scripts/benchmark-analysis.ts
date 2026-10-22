import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { calculateAnalysis } from "../src/analysis-engine";
import { demoFixture } from "../src/demo-fixture";
import { dateKey, shiftDay } from "../src/analysis-common";
import { Prisma } from "../src/generated/prisma/client";
import { defaultIntelligencePolicy } from "../../../packages/contracts/src/index";
const today = dateKey(new Date(), "America/Cuiaba");
const results = [];
for (const count of [1000, 10000, 50000]) {
  const products = Array.from(
    { length: 10 },
    () => demoFixture(randomUUID(), randomUUID(), today)[0],
  );
  for (const p of products) {
    const template = p.movements.find((m) => m.kind === "CONSUMPTION")!;
    const perProduct = count / products.length;
    p.movements = Array.from({ length: perProduct }, (_, i) => ({
      ...template,
      id: randomUUID(),
      sequence: BigInt(i + 1),
      delta: new Prisma.Decimal(-1),
      occurredAt: new Date(
        shiftDay(today, -90 + Math.floor((i * 90) / perProduct)) + "T12:00:00Z",
      ),
    }));
  }
  const memoryBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  const value = calculateAnalysis(products, today, "America/Cuiaba", 1, {
    policyVersion: 1,
    reorderDays: 7,
    expiryWarningDays: 30,
    inactivityDays: 90,
    intelligence: { ...defaultIntelligencePolicy },
  });
  const row = {
    movements: count,
    products: products.length,
    elapsedMs: Math.round(performance.now() - start),
    heapDeltaMB: Math.round(
      (process.memoryUsage().heapUsed - memoryBefore) / 1048576,
    ),
    alerts: value.alerts.length,
  };
  results.push(row);
  console.log(JSON.stringify(row));
}
const folder = new URL("../../../tmp/", import.meta.url);
await mkdir(folder, { recursive: true });
await writeFile(
  new URL("analysis-benchmark.json", folder),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      scope:
        "Motor em memória, sem I/O, banco, rede ou teste de concorrência. Uma medição por tamanho; não é SLA.",
      results,
    },
    null,
    2,
  ),
);

import { randomUUID } from "node:crypto";
import { Prisma } from "./generated/prisma/client";
import type { AnalysisInput } from "./analysis-engine";
import { shiftDay } from "./analysis-common";

export function demoFixture(
  propertyId: string,
  actorId: string,
  today: string,
): AnalysisInput[] {
  const D = (v: number) => new Prisma.Decimal(v);
  const definitions = [
    {
      name: "Diesel S10",
      category: "Combustíveis e lubrificantes",
      unit: "L",
      balance: 420,
      rate: 60,
      minimum: 500,
      cost: 5,
      expiry: 300,
    },
    {
      name: "Fertilizante NPK",
      category: "Fertilizantes",
      unit: "kg",
      balance: 120,
      rate: 10,
      minimum: 200,
      cost: 3,
      expiry: 300,
    },
    {
      name: "Herbicida demonstrativo",
      category: "Defensivos e biológicos",
      unit: "L",
      balance: 40,
      rate: 1,
      minimum: 10,
      cost: 45,
      expiry: 5,
    },
    {
      name: "Peça de manutenção",
      category: "Peças e manutenção",
      unit: "un",
      balance: 5,
      rate: 0,
      minimum: 1,
      cost: 600,
      expiry: null,
    },
    {
      name: "Material de irrigação",
      category: "Materiais de irrigação",
      unit: "un",
      balance: 1500,
      rate: 1,
      minimum: 100,
      cost: 3,
      expiry: null,
    },
    {
      name: "Semente sem referência",
      category: "Sementes",
      unit: "kg",
      balance: 80,
      rate: 0,
      minimum: null,
      cost: null,
      expiry: undefined,
    },
  ];
  let sequence = 0n;
  return definitions.map((d, index) => {
    const id = randomUUID(),
      lotId = randomUUID();
    const opening = d.balance + d.rate * 90 - (index === 0 ? 200 : 0);
    const stamp = (n: number) => new Date(shiftDay(today, n) + "T12:00:00Z");
    const movement = (
      kind: "OPENING" | "IN" | "CONSUMPTION",
      delta: number,
      offset: number,
      target = lotId,
      cost = d.cost,
    ) => ({
      id: randomUUID(),
      sequence: ++sequence,
      productId: id,
      lotId: target,
      kind,
      delta: D(delta),
      unitCost: cost === null ? null : D(cost),
      occurredAt: stamp(offset),
      recordedAt: new Date(),
      actorId,
      actorName: "Demonstração AgroMind",
      originalResponsible: "João Exemplo",
      originalReference: `DEMO-${index}-${sequence}`,
      originalLine: null,
      consumptionConfirmed: true,
      destination: kind === "CONSUMPTION" ? "Operação demonstrativa" : null,
      notes: "Dado fictício para demonstração",
      source: "WEB",
      requestKey: randomUUID(),
      reversalOf: null,
      importBatchId: null,
      fingerprint: null,
    });
    const lot = {
      id: lotId,
      productId: id,
      code: `DEMO-${index + 1}`,
      expiresOn:
        typeof d.expiry === "number"
          ? new Date(shiftDay(today, d.expiry))
          : null,
      expiryStatus:
        d.expiry === undefined ? "UNKNOWN" : d.expiry === null ? "NA" : "DATED",
      unitCost: d.cost === null ? null : D(d.cost),
      supplier: "Fornecedor fictício",
      balance: D(d.balance - (index === 0 ? 200 : 0)),
      createdAt: stamp(-100),
    };
    const movements = [movement(index === 0 ? "IN" : "OPENING", opening, -100)];
    for (let n = -90; n < 0; n++)
      if (d.rate) movements.push(movement("CONSUMPTION", -d.rate, n));
    const lots = [lot];
    if (index === 0) {
      const secondId = randomUUID();
      lots.push({
        ...lot,
        id: secondId,
        code: "DEMO-DIESEL-2",
        balance: D(200),
        unitCost: D(6),
        expiresOn: new Date(shiftDay(today, 360)),
        createdAt: stamp(-15),
      });
      movements.push(movement("IN", 200, -15, secondId, 6));
    }
    return {
      id,
      propertyId,
      name: d.name,
      nameKey: d.name
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase(),
      category: d.category,
      unit: d.unit,
      minimum: D(d.minimum ?? 0),
      minimumKnown: d.minimum !== null,
      coverageStart: d.minimum === null ? null : new Date(shiftDay(today, -90)),
      coverageEnd: d.minimum === null ? null : new Date(shiftDay(today, -1)),
      coverageOngoing: d.minimum !== null,
      coverageConfirmedBy: d.minimum === null ? null : actorId,
      leadTimeDays: null,
      safetyDays: 0,
      positionOn: null,
      archived: false,
      createdAt: stamp(-100),
      updatedAt: new Date(),
      lots,
      movements,
    };
  });
}

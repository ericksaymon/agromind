import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { db } from "../src/db";
import { digest, randomToken, sessionCookie } from "../src/security";
import { settings } from "../src/config";
import { dateKey, shiftDay } from "../src/analysis-common";
import { processAnalysis } from "../src/analysis-service";
import { defaultIntelligencePolicy } from "../../../packages/contracts/src/index";
let app: Awaited<ReturnType<typeof buildApp>>;
const users: string[] = [],
  properties: string[] = [];
const today = dateKey(new Date(), "America/Cuiaba");
class Client {
  cookie = "";
  csrf = "";
  constructor(public userId: string) {}
  async init() {
    const token = randomToken();
    await db.session.create({
      data: {
        userId: this.userId,
        tokenHash: digest(token),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    this.cookie = `${sessionCookie}=${token}`;
    const r = await this.get("/api/auth/csrf");
    this.csrf = r.json().token;
    this.cookie += r.cookies.map((c) => `; ${c.name}=${c.value}`).join("");
    return this;
  }
  get(url: string) {
    return app.inject({ method: "GET", url, headers: { cookie: this.cookie } });
  }
  post(url: string, payload: object) {
    return app.inject({
      method: "POST",
      url,
      payload,
      headers: {
        cookie: this.cookie,
        origin: settings.origin,
        "x-csrf-token": this.csrf,
      },
    });
  }
}
let admin: Client, operator: Client, viewer: Client, outsider: Client;
before(async () => {
  app = await buildApp({ test: true });
  const clients: Client[] = [];
  for (const role of ["admin", "operator", "viewer", "outsider"]) {
    const u = await db.user.create({
      data: {
        name: `Inteligência ${role}`,
        email: `${randomUUID()}@example.test`,
        passwordHash: "not-used",
        emailVerifiedAt: new Date(),
      },
    });
    users.push(u.id);
    clients.push(await new Client(u.id).init());
  }
  [admin, operator, viewer, outsider] = clients;
});
after(async () => {
  await db.property.deleteMany({ where: { id: { in: properties } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await app.close();
  await db.$disconnect();
});
async function fixture() {
  const f = await db.$transaction(async (tx) => {
    const property = await tx.property.create({
      data: {
        name: "Fazenda de inteligência sintética",
        responsible: "Teste",
        timezone: "America/Cuiaba",
        startMethod: "MANUAL",
        memberships: {
          create: [
            { userId: admin.userId, role: "ADMIN" },
            { userId: operator.userId, role: "OPERATOR" },
            { userId: viewer.userId, role: "VIEWER" },
          ],
        },
      },
    });
    const product = await tx.product.create({
      data: {
        propertyId: property.id,
        name: "Diesel S10",
        nameKey: "diesel s10",
        category: "Combustíveis",
        unit: "L",
        minimum: "100",
        minimumKnown: true,
        coverageStart: new Date(shiftDay(today, -110)),
        coverageEnd: new Date(shiftDay(today, -1)),
        coverageOngoing: true,
      },
    });
    const lot = await tx.stockLot.create({
      data: {
        productId: product.id,
        code: "D-01",
        balance: "3700",
        unitCost: "5",
        expiryStatus: "NA",
        supplier: "Fornecedor A",
      },
    });
    const lot2 = await tx.stockLot.create({
      data: {
        productId: product.id,
        code: "D-02",
        balance: "1000",
        unitCost: "6",
        expiryStatus: "NA",
        supplier: "Fornecedor B",
      },
    });
    const common = {
      productId: product.id,
      actorId: admin.userId,
      actorName: "Teste",
      source: "WEB",
    };
    await tx.stockMovement.createMany({
      data: [
        {
          ...common,
          lotId: lot.id,
          kind: "IN",
          delta: "5000",
          unitCost: "5",
          occurredAt: new Date(shiftDay(today, -101) + "T12:00:00Z"),
          requestKey: randomUUID(),
        },
        {
          ...common,
          lotId: lot2.id,
          kind: "IN",
          delta: "1000",
          unitCost: "6",
          occurredAt: new Date(shiftDay(today, -15) + "T12:00:00Z"),
          requestKey: randomUUID(),
        },
        ...Array.from({ length: 100 }, (_, i) => ({
          ...common,
          lotId: lot.id,
          kind: "CONSUMPTION" as const,
          delta: i >= 70 ? "-20" : "-10",
          unitCost: "5",
          occurredAt: new Date(shiftDay(today, -100 + i) + "T12:00:00Z"),
          destination: "Trator",
          requestKey: randomUUID(),
        })),
      ],
    });
    return { property, product, lot, base: `/api/properties/${property.id}` };
  });
  properties.push(f.property.id);
  return f;
}
test("relatório íntegro: períodos, finanças, preços, filtros e sinais persistidos na mesma revisão", async () => {
  const f = await fixture();
  let response = await viewer.get(f.base + "/intelligence");
  assert.equal(response.statusCode, 200, response.body);
  const r = response.json().result,
    p = r.products[0];
  assert.equal(p.changePercent, "100");
  assert.equal(r.summary.currentValue, "24500.00");
  assert.equal(r.summary.purchaseValue, "6000.00");
  assert.equal(r.summary.consumptionValue, "3000.00");
  assert.equal(p.priceChangePercent, "20");
  assert.equal(p.weightedCost, "5.2127659574468085106");
  const analysis = (await admin.get(f.base + "/analysis")).json();
  assert.equal(r.revision, analysis.result.revision);
  assert.equal(r.ruleVersion, analysis.result.ruleVersion);
  assert.ok(
    analysis.alerts.some(
      (a: any) => a.rule === "CONSUMPTION_CHANGE" && !a.closedAt,
    ),
  );
  assert.ok(
    analysis.alerts.some((a: any) => a.rule === "PRICE_CHANGE" && !a.closedAt),
  );
  assert.ok(
    analysis.alerts.some((a: any) => a.rule === "EXCESS" && !a.closedAt),
  );
  response = await viewer.get(f.base + "/intelligence?category=Ausente");
  assert.equal(response.json().total, 0);
  assert.equal(response.json().result.summary.currentValue, "0.00");
  assert.equal((await outsider.get(f.base + "/intelligence")).statusCode, 404);
  assert.equal(
    (await viewer.get(f.base + `/intelligence?from=${today}&to=${today}`))
      .statusCode,
    400,
  );
  assert.equal(
    (await viewer.get(f.base + "/intelligence?from=2024-01-01&to=2025-12-31"))
      .statusCode,
    400,
  );
  assert.equal(
    (await viewer.get(f.base + "/intelligence?productId=" + randomUUID()))
      .statusCode,
    404,
  );
});
test("simulação VIEWER é somente leitura, considera atraso, consumo zero e ausência de cobertura", async () => {
  const f = await fixture();
  await processAnalysis(f.property.id);
  const counts = async () => ({
    movements: await db.stockMovement.count({
      where: { productId: f.product.id },
    }),
    analyses: await db.analysisSnapshot.count({
      where: { propertyId: f.property.id },
    }),
    events: await db.analysisEvent.count({
      where: { propertyId: f.property.id },
    }),
    requests: await db.stockRequest.count({
      where: { propertyId: f.property.id },
    }),
    revision: (
      await db.property.findUniqueOrThrow({ where: { id: f.property.id } })
    ).inventoryRevision,
    balance: (
      await db.stockLot.findUniqueOrThrow({ where: { id: f.lot.id } })
    ).balance.toString(),
  });
  const before = await counts();
  const body = {
    productId: f.product.id,
    horizonDays: 365,
    consumptionPercent: 500,
    quantity: "20000",
    arrivalDay: shiftDay(today, 100),
    expiryStatus: "NA",
    unitCost: "6",
  };
  let r = await viewer.post(f.base + "/intelligence/simulate", body);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().scenarioRate, "120");
  assert.ok(Number(r.json().scenario.unmetBeforeArrival) > 0);
  assert.equal(r.json().estimatedCost, "120000.00");
  r = await viewer.post(f.base + "/intelligence/simulate", {
    ...body,
    consumptionPercent: -100,
    quantity: "0",
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().scenarioRate, "0");
  assert.equal(r.json().scenario.shortageDays, 0);
  assert.equal(r.json().scenario.firstShortageDay, null);
  assert.deepEqual(await counts(), before);
  assert.equal(
    (await outsider.post(f.base + "/intelligence/simulate", body)).statusCode,
    404,
  );
  assert.equal(
    (
      await viewer.post(f.base + "/intelligence/simulate", {
        ...body,
        productId: randomUUID(),
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await viewer.post(f.base + "/intelligence/simulate", {
        ...body,
        expiryStatus: "DATED",
        expiresOn: today,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await viewer.post(f.base + "/intelligence/simulate", {
        ...body,
        quantity: "-1",
      })
    ).statusCode,
    400,
  );
  await db.$transaction([
    db.product.update({
      where: { id: f.product.id },
      data: { coverageStart: null, coverageEnd: null, coverageOngoing: false },
    }),
    db.property.update({
      where: { id: f.property.id },
      data: { inventoryRevision: { increment: 1 }, analysisPending: true },
    }),
  ]);
  r = await viewer.post(f.base + "/intelligence/simulate", body);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().scenario, null);
});
test("políticas da inteligência são administrativas, versionadas e preservadas pela configuração básica", async () => {
  const f = await fixture();
  const first = (await admin.get(f.base + "/analysis")).json();
  const alert = first.alerts.find((a: any) => a.rule === "CONSUMPTION_CHANGE");
  assert.ok(alert);
  const data = {
    policyVersion: 1,
    reorderDays: 7,
    expiryWarningDays: 30,
    inactivityDays: 90,
    intelligence: {
      ...defaultIntelligencePolicy,
      consumptionChangePercent: 200,
    },
    reason: "Critério operacional conferido",
  };
  assert.equal(
    (await viewer.post(f.base + "/analysis/policy", data)).statusCode,
    403,
  );
  assert.equal(
    (await operator.post(f.base + "/analysis/policy", data)).statusCode,
    403,
  );
  assert.equal(
    (await admin.post(f.base + "/analysis/policy", data)).statusCode,
    200,
  );
  const next = (await admin.get(f.base + "/analysis")).json();
  assert.equal(next.policy.policyVersion, 2);
  assert.ok(next.alerts.find((a: any) => a.id === alert.id).closedAt);
  const basic = {
    policyVersion: 2,
    reorderDays: 7,
    expiryWarningDays: 30,
    inactivityDays: 90,
    reason: "Ajuste dos critérios básicos sem apagar inteligência",
  };
  assert.equal(
    (await admin.post(f.base + "/analysis/policy", basic)).statusCode,
    200,
  );
  assert.equal(
    (await admin.get(f.base + "/analysis")).json().policy.intelligence
      .consumptionChangePercent,
    200,
  );
  const history = (await admin.get(f.base + "/analysis/policy/history")).json()
    .events;
  assert.equal(history[0].actorId, admin.userId);
  assert.equal(
    history[0].details.before.intelligence.consumptionChangePercent,
    200,
  );
});
test("simulação aceita média decimal periódica e exige reposição inteira em un", async () => {
  const f = await fixture();
  const product = await db.product.create({
    data: {
      propertyId: f.property.id,
      name: "Peça avulsa",
      nameKey: "peca avulsa",
      category: "Peças",
      unit: "un",
      minimum: "0",
      minimumKnown: true,
      coverageStart: new Date(shiftDay(today, -30)),
      coverageEnd: new Date(shiftDay(today, -1)),
      coverageOngoing: true,
    },
  });
  const lot = await db.stockLot.create({
    data: {
      productId: product.id,
      code: "AVULSA",
      balance: "0",
      unitCost: "1",
      expiryStatus: "NA",
    },
  });
  await db.stockMovement.createMany({
    data: [
      {
        productId: product.id,
        lotId: lot.id,
        kind: "IN",
        delta: "1",
        unitCost: "1",
        occurredAt: new Date(shiftDay(today, -30) + "T12:00:00Z"),
        actorId: admin.userId,
        actorName: "Teste",
        source: "WEB",
        requestKey: randomUUID(),
      },
      {
        productId: product.id,
        lotId: lot.id,
        kind: "CONSUMPTION",
        delta: "-1",
        unitCost: "1",
        occurredAt: new Date(shiftDay(today, -1) + "T12:00:00Z"),
        actorId: admin.userId,
        actorName: "Teste",
        source: "WEB",
        destination: "Máquina",
        requestKey: randomUUID(),
      },
    ],
  });
  await db.property.update({
    where: { id: f.property.id },
    data: { inventoryRevision: { increment: 1 }, analysisPending: true },
  });
  const body = {
    productId: product.id,
    horizonDays: 30,
    consumptionPercent: 10,
    quantity: "1",
    arrivalDay: today,
    expiryStatus: "NA",
  };
  const result = await viewer.post(f.base + "/intelligence/simulate", body);
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().baselineRate, "0.033333333333333333333");
  assert.ok(Number(result.json().scenarioRate) > 0);
  assert.equal(
    (
      await viewer.post(f.base + "/intelligence/simulate", {
        ...body,
        quantity: "0.5",
      })
    ).statusCode,
    400,
  );
});

test("produtos e eventos têm paginação explícita; arquivamento conserva valores históricos", async () => {
  const f = await fixture();
  await db.product.createMany({
    data: Array.from({ length: 22 }, (_, i) => ({
      propertyId: f.property.id,
      name: `Produto adicional ${i.toString().padStart(2, "0")}`,
      nameKey: `produto adicional ${i}`,
      category: "Outros",
      unit: "kg",
      archived: false,
    })),
  });
  let r = await viewer.get(f.base + "/intelligence");
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().total, 23);
  assert.equal(r.json().result.products.length, 20);
  assert.equal(r.json().result.summary.currentValue, "24500.00");
  r = await viewer.get(f.base + "/intelligence?page=2");
  assert.equal(r.json().result.products.length, 3);
  assert.equal(r.json().result.summary.currentValue, "24500.00");
  // O cadastro arquivado é sintético, com saldo zero; suas compras/retiradas seguem visíveis no histórico.
  const product = await db.product.create({
    data: {
      propertyId: f.property.id,
      name: "Peça histórica",
      nameKey: "peca historica",
      category: "Peças",
      unit: "un",
      archived: true,
    },
  });
  const lot = await db.stockLot.create({
    data: {
      productId: product.id,
      code: "P-01",
      balance: "0",
      unitCost: "10",
      expiryStatus: "NA",
    },
  });
  await db.stockMovement.createMany({
    data: [
      {
        productId: product.id,
        lotId: lot.id,
        kind: "IN",
        delta: "2",
        unitCost: "10",
        occurredAt: new Date(shiftDay(today, -3) + "T12:00:00Z"),
        actorId: admin.userId,
        actorName: "Teste",
        source: "WEB",
        requestKey: randomUUID(),
      },
      {
        productId: product.id,
        lotId: lot.id,
        kind: "CONSUMPTION",
        delta: "-2",
        unitCost: "10",
        occurredAt: new Date(shiftDay(today, -2) + "T12:00:00Z"),
        actorId: admin.userId,
        actorName: "Teste",
        source: "WEB",
        destination: "Máquina",
        requestKey: randomUUID(),
      },
    ],
  });
  r = await viewer.get(f.base + `/intelligence?productId=${product.id}`);
  assert.equal(r.json().result.summary.currentValue, "0.00");
  assert.equal(r.json().result.summary.purchaseValue, "20.00");
  assert.equal(r.json().result.summary.consumptionValue, "20.00");
});

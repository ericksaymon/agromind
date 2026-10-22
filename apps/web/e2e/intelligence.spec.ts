import { test, expect, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import argon2 from "../../api/node_modules/argon2/argon2.cjs";
import { db } from "../../api/src/db";
import { dateKey, shiftDay } from "../../api/src/analysis-common";
const today = dateKey(new Date(), "America/Cuiaba"),
  email = `intelligence-e2e-${randomUUID()}@example.test`,
  password = "Teste123";
let userId: string, propertyId: string, dieselId: string;
async function audit(page: Page, label: string) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    r.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    label,
  ).toEqual([]);
}
test.beforeAll(async () => {
  const u = await db.user.create({
    data: {
      name: "João do teste de inteligência",
      email,
      passwordHash: await argon2.hash(password),
      emailVerifiedAt: new Date(),
    },
  });
  userId = u.id;
  await db.$transaction(async (tx) => {
    const p = await tx.property.create({
      data: {
        name: "Fazenda de planejamento de teste",
        responsible: u.name,
        timezone: "America/Cuiaba",
        startMethod: "MANUAL",
        memberships: { create: { userId, role: "ADMIN" } },
      },
    });
    propertyId = p.id;
    const diesel = await tx.product.create({
      data: {
        propertyId,
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
    dieselId = diesel.id;
    const l1 = await tx.stockLot.create({
      data: {
        productId: dieselId,
        code: "D-01",
        balance: "220",
        unitCost: "5",
        expiryStatus: "NA",
        supplier: "Fornecedor A",
      },
    });
    const l2 = await tx.stockLot.create({
      data: {
        productId: dieselId,
        code: "D-02",
        balance: "200",
        unitCost: "6",
        expiryStatus: "NA",
        supplier: "Fornecedor B",
      },
    });
    const common = {
      productId: dieselId,
      actorId: userId,
      actorName: u.name,
      source: "WEB",
    };
    await tx.stockMovement.createMany({
      data: [
        {
          ...common,
          lotId: l1.id,
          kind: "IN",
          delta: "1620",
          unitCost: "5",
          occurredAt: new Date(shiftDay(today, -101) + "T12:00:00Z"),
          requestKey: randomUUID(),
        },
        {
          ...common,
          lotId: l2.id,
          kind: "IN",
          delta: "200",
          unitCost: "6",
          occurredAt: new Date(shiftDay(today, -15) + "T12:00:00Z"),
          requestKey: randomUUID(),
        },
        ...Array.from({ length: 100 }, (_, i) => ({
          ...common,
          lotId: l1.id,
          kind: "CONSUMPTION" as const,
          delta: i >= 70 ? "-20" : "-10",
          unitCost: "5",
          occurredAt: new Date(shiftDay(today, -100 + i) + "T12:00:00Z"),
          destination: "Trator",
          requestKey: randomUUID(),
        })),
        {
          ...common,
          lotId: l1.id,
          kind: "CONSUMPTION",
          delta: "-100",
          unitCost: "5",
          occurredAt: new Date(),
          destination: "Trator 02",
          requestKey: randomUUID(),
        },
      ],
    });
    for (const item of [
      {
        name: "Fertilizante NPK",
        unit: "kg",
        category: "Fertilizantes",
        minimum: "100",
        balance: "1500",
        cost: "3",
        daily: true,
      },
      {
        name: "Peça de manutenção",
        unit: "un",
        category: "Peças",
        minimum: "1",
        balance: "5",
        cost: "600",
        daily: false,
      },
    ]) {
      const product = await tx.product.create({
        data: {
          propertyId,
          name: item.name,
          nameKey: randomUUID(),
          category: item.category,
          unit: item.unit,
          minimum: item.minimum,
          minimumKnown: true,
          coverageStart: new Date(shiftDay(today, -110)),
          coverageEnd: new Date(shiftDay(today, -1)),
          coverageOngoing: true,
        },
      });
      const lot = await tx.stockLot.create({
        data: {
          productId: product.id,
          code: "L-01",
          balance: item.balance,
          unitCost: item.cost,
          expiryStatus: "NA",
        },
      });
      await tx.stockMovement.create({
        data: {
          productId: product.id,
          lotId: lot.id,
          kind: "IN",
          delta: item.daily ? "1600" : item.balance,
          unitCost: item.cost,
          occurredAt: new Date(shiftDay(today, -101) + "T12:00:00Z"),
          actorId: userId,
          actorName: u.name,
          source: "WEB",
          requestKey: randomUUID(),
        },
      });
      if (item.daily)
        await tx.stockMovement.createMany({
          data: Array.from({ length: 100 }, (_, i) => ({
            productId: product.id,
            lotId: lot.id,
            kind: "CONSUMPTION" as const,
            delta: "-1",
            unitCost: item.cost,
            occurredAt: new Date(shiftDay(today, -100 + i) + "T12:00:00Z"),
            actorId: userId,
            actorName: u.name,
            source: "WEB",
            destination: "Área produtiva",
            requestKey: randomUUID(),
          })),
        });
    }
  });
});
test.afterAll(async () => {
  if (propertyId) await db.property.deleteMany({ where: { id: propertyId } });
  if (userId) await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});
test("inteligência: consumo, finanças, capital parado, cenário sem gravação, regras e acessibilidade", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/entrar");
  await page.locator('[data-form-ready="true"]').waitFor();
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();
  await expect(page).toHaveURL("/app");
  await page.getByRole("link", { name: "Inteligência", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Inteligência do estoque", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".analysis-reference").first()).toContainText(
    "Dados conferidos nesta consulta",
  );
  await page
    .getByLabel("Produto no gráfico", { exact: true })
    .selectOption(dieselId);
  await expect(
    page.getByRole("region", { name: "Comparação de consumo", exact: true }),
  ).toContainText("100%");
  await expect(
    page.getByRole("region", {
      name: "Retiradas acima da referência",
      exact: true,
    }),
  ).toContainText("100 L");
  await page.getByText("Ver série em tabela", { exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Série de consumo", exact: true }),
  ).toContainText("20");
  await audit(page, "consumo e comparação desktop");
  await page.screenshot({
    path: "../../tmp/phase5-consumption-desktop.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Finanças", exact: true }).click();
  await expect(page.locator(".intel-metrics").first()).toContainText(
    "9.800,00",
  );
  await expect(page.locator(".intel-price-comparison")).toContainText("20%");
  await audit(page, "finanças e preços desktop");
  await page.screenshot({
    path: "../../tmp/phase5-finance-desktop.png",
    fullPage: true,
  });
  await page
    .getByLabel("Período: de", { exact: true })
    .fill(shiftDay(today, -60));
  await page.getByLabel("Até", { exact: true }).fill(shiftDay(today, -31));
  await page
    .getByRole("button", { name: "Aplicar filtros", exact: true })
    .click();
  await expect(page.locator(".intel-price-comparison")).toContainText(
    "São necessárias duas aquisições",
  );
  await expect(page.locator(".intel-metrics").first()).toContainText(
    "9.800,00",
  );
  await page
    .getByLabel("Período: de", { exact: true })
    .fill(shiftDay(today, -30));
  await page.getByLabel("Até", { exact: true }).fill(shiftDay(today, -1));
  await page.getByLabel("Agrupar", { exact: true }).selectOption("WEEK");
  await page
    .getByRole("button", { name: "Aplicar filtros", exact: true })
    .click();
  await expect(page.locator(".intel-price-comparison")).toContainText("20%");
  await page
    .getByRole("tab", { name: "Excesso e capital parado", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Excesso e capital parado", exact: true }),
  ).toContainText("1.400 kg");
  await expect(page.locator(".intel-metrics").first()).toContainText(
    "3.000,00",
  );
  await audit(page, "excesso e capital parado desktop");
  await page
    .getByRole("tab", { name: "Planejamento e simulação", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Sugestão de reposição", exact: true }),
  ).toContainText("180 L");
  const counts = async () => ({
    movements: await db.stockMovement.count({
      where: { product: { propertyId } },
    }),
    revision: (
      await db.property.findUniqueOrThrow({ where: { id: propertyId } })
    ).inventoryRevision,
  });
  const before = await counts();
  await page
    .getByLabel("Produto do cenário", { exact: true })
    .selectOption(dieselId);
  await page
    .getByLabel("Duração do cenário (dias)", { exact: true })
    .fill("30");
  await page.getByLabel("Variação de consumo (%)", { exact: true }).fill("50");
  await page
    .getByLabel("Reposição hipotética (L)", { exact: true })
    .fill("1000");
  await page
    .getByLabel("Data hipotética de chegada", { exact: true })
    .fill(shiftDay(today, 25));
  await page
    .getByLabel("Custo hipotético por unidade (R$)", { exact: true })
    .fill("7");
  await page
    .getByRole("button", { name: "Comparar cenário", exact: true })
    .click();
  await expect(page.locator(".intel-simulation-result")).toContainText("330 L");
  await expect(page.locator(".intel-simulation-result")).toContainText("850 L");
  await expect(page.locator(".intel-simulation-result")).toContainText(
    "7.000,00",
  );
  expect(await counts()).toEqual(before);
  await page
    .getByText("Ver projeção diária em tabela", { exact: true })
    .click();
  await expect(
    page.getByRole("region", {
      name: "Comparação diária dos cenários",
      exact: true,
    }),
  ).toContainText("1.000");
  await audit(page, "simulação desktop");
  await page.screenshot({
    path: "../../tmp/phase5-simulation-desktop.png",
    fullPage: true,
  });
  await page
    .getByLabel("Variação de consumo (%)", { exact: true })
    .fill("-100");
  await expect(
    page.locator(".intel-simulation-result .analysis-reference"),
  ).toContainText("Cenário anterior");
  await page
    .getByRole("button", { name: "Comparar cenário", exact: true })
    .click();
  await expect(page.locator(".intel-simulation-result")).toContainText(
    "Consumo hipotético zero",
  );
  expect(await counts()).toEqual(before);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const title of [
      "Consumo",
      "Finanças",
      "Excesso e capital parado",
      "Planejamento e simulação",
    ]) {
      await page.getByRole("tab", { name: title, exact: true }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${title} em ${width}px`,
      ).toBe(true);
      if (width === 390) {
        await audit(page, title + " no celular");
        await page.screenshot({
          path: `../../tmp/phase5-${title === "Consumo" ? "consumption" : title === "Finanças" ? "finance" : title.startsWith("Excesso") ? "excess" : "planning"}-mobile.png`,
          fullPage: true,
        });
      }
    }
  }
  let releasePolicy!: () => void;
  const policyGate = new Promise<void>(resolve => { releasePolicy = resolve; });
  const policyUrl = `**/api/properties/${propertyId}/analysis`;
  await page.route(policyUrl, async route => { const response = await route.fetch(); await policyGate; await route.fulfill({ response }); });
  await page
    .getByRole("button", { name: "Critérios da inteligência", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Mudança de consumo mínima (%)", { exact: true })).toBeDisabled();
  releasePolicy();
  await dialog
    .getByLabel("Mudança de consumo mínima (%)", { exact: true })
    .fill("150");
  await dialog
    .getByLabel("Motivo da alteração dos critérios", { exact: true })
    .fill("Critérios conferidos para o período operacional");
  await audit(page, "política da inteligência");
  await dialog
    .getByRole("button", { name: "Salvar critérios e reavaliar", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.unroute(policyUrl);
  await expect(page.locator(".analysis-reference").first()).toContainText(
    "política 2",
  );
  await page.getByRole("link", { name: "Ver alertas", exact: true }).click();
  await page
    .getByLabel("Tipo", { exact: true })
    .selectOption("CONSUMPTION_CHANGE");
  await expect(
    page.getByRole("heading", { name: "0 ocorrências", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Risco", { exact: true }).selectOption("closed");
  await expect(
    page.getByRole("button", { name: /Consumo recente aumentou/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

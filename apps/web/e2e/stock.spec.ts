import { test, expect, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
async function audit(page: Page, label: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    label,
  ).toEqual([]);
}
import { randomUUID } from "node:crypto";
import argon2 from "../../api/node_modules/argon2/argon2.cjs";
import { db } from "../../api/src/db";
const email = `stock-e2e-${randomUUID()}@example.test`,
  password = "Teste123";
let propertyId: string, userId: string;
test.beforeAll(async () => {
  const user = await db.user.create({
    data: {
      name: "Operador de teste",
      email,
      emailVerifiedAt: new Date(),
      passwordHash: await argon2.hash(password),
    },
  });
  userId = user.id;
  const property = await db.property.create({
    data: {
      name: "Fazenda de teste operacional",
      responsible: "Operador de teste",
      timezone: "America/Cuiaba",
      startMethod: "MANUAL",
      memberships: { create: { userId: user.id, role: "ADMIN" } },
    },
  });
  propertyId = property.id;
});
test.afterAll(async () => {
  if (propertyId) await db.property.delete({ where: { id: propertyId } });
  if (userId) await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
});
test("estoque real: cadastro, lote, consumo, estorno e importação conferida", async ({
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
  await page.goto("/app/estoque");
  await expect(
    page.getByRole("heading", { name: "Meus insumos", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Pronto para receber o primeiro insumo.",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Novo produto", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome do insumo").fill("Diesel S10");
  await dialog.getByRole("radio", { name: "Combustíveis" }).click();
  await dialog.getByLabel(/Avisar quando faltar/).fill("30");
  await dialog.getByRole("button", { name: "Só cadastrar" }).click();
  await expect(page.getByRole("status")).toContainText("Produto cadastrado");
  await page.getByRole("link", { name: "Diesel S10", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Diesel S10", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Movimentar", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tipo de operação").selectOption("OPENING");
  await dialog.getByLabel("Quantidade (L)", { exact: true }).fill("100");
  await dialog.getByLabel("Código do lote").fill("DIESEL-01");
  await dialog.getByRole("combobox", { name: /^Validade/ }).selectOption("NA");
  await dialog.getByLabel("Custo unitário (R$)", { exact: false }).fill("6,10");
  await dialog
    .getByLabel("Fornecedor", { exact: false })
    .fill("Fornecedor teste");
  await dialog.getByLabel("Data do fato").fill("2026-10-01");
  await audit(page, "formulário de movimentação");
  await dialog.getByRole("button", { name: "Conferir movimentação" }).click();
  await dialog.getByRole("button", { name: "Confirmar movimentação" }).click();
  await expect(page.locator(".stock-summary")).toContainText("100 L");
  await page.getByRole("button", { name: "Movimentar", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tipo de operação").selectOption("CONSUMPTION");
  await dialog.getByLabel("Quantidade (L)", { exact: true }).fill("25");
  await dialog.getByLabel("Destino", { exact: true }).fill("Trator 01");
  await dialog.getByLabel("Data do fato").fill("2026-10-02");
  await dialog.getByRole("button", { name: "Conferir movimentação" }).click();
  await expect(dialog).toContainText("75 L");
  await audit(page, "confirmação de movimentação");
  await page.screenshot({
    path: "../../tmp/phase3-movement-review.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Confirmar movimentação" }).click();
  await expect(page.locator(".stock-summary")).toContainText("75 L");
  await page.reload();
  await expect(page.locator(".stock-summary")).toContainText("75 L");
  await page.screenshot({
    path: "../../tmp/phase3-product-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Estornar", exact: true })
    .first()
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Motivo do estorno")
    .fill("Registro lançado no destino errado");
  await dialog.getByRole("button", { name: "Confirmar estorno" }).click();
  await expect(page.locator(".stock-summary")).toContainText("100 L");
  await page.goto("/app/importar");
  await expect(
    page.getByRole("heading", { name: "Importar estoque", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Arquivo da planilha")
    .setInputFiles({
      name: "posicao.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "produto;categoria;quantidade;unidade;estoque_minimo;custo_unitario;lote;validade\nFertilizante NPK;Fertilizantes;120;kg;200;3,80;NPK-01;N/A\nSemente de milho;Sementes;erro;kg;50;;SE-01;\n",
      ),
    });
  await page.getByRole("button", { name: "Ler planilha" }).click();
  await expect(
    page.getByRole("heading", { name: "Associe as colunas da planilha" }),
  ).toBeVisible();
  await page
    .locator("label")
    .filter({ hasText: "Data desta posição de estoque" })
    .locator("input")
    .fill("2026-10-01");
  await audit(page, "mapeamento da importação");
  await page.screenshot({
    path: "../../tmp/phase3-import-map.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Gerar prévia para conferência" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Confira o que será importado" }),
  ).toBeVisible();
  await expect(page.getByLabel("Importar registro 3")).toBeDisabled();
  const reconciliation = page.getByRole("region", { name: "Conciliação dos saldos", exact: true });
  await expect(reconciliation).toContainText("120");
  await page.getByLabel("Saldo conferido de Fertilizante NPK", { exact: true }).fill("100");
  await expect(reconciliation).toContainText("Divergência: -20 kg");
  await page.getByLabel("Saldo conferido de Fertilizante NPK", { exact: true }).fill("120");
  await expect(reconciliation).toContainText("Saldos conferem");
  await page.getByLabel("Importar registro 2").uncheck();
  await expect(reconciliation).not.toContainText("Fertilizante NPK");
  await page.getByLabel("Importar registro 2").check();
  await audit(page, "prévia com pendência");
  await page.setViewportSize({ width: 390, height: 1000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../tmp/phase3-preview-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Revisar registro" }).nth(1).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Quantidade", { exact: true }).fill("50");
  await audit(page, "correção da importação no celular");
  await page.screenshot({
    path: "../../tmp/phase3-correction-mobile.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Valores originais" }).click();
  await expect(dialog).toContainText("erro");
  await dialog
    .getByRole("button", { name: "Aplicar correção e validar" })
    .click();
  await expect(page.getByLabel("Importar registro 3")).toBeEnabled();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByLabel(
      "Conferi os dados, as associações de produtos, os avisos e as linhas selecionadas.",
    )
    .check();
  await page.screenshot({
    path: "../../tmp/phase3-import-preview.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Importar 2 registros", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Confirmar importação" }).click();
  await expect(
    page.getByRole("heading", { name: "Estoque atualizado com sua planilha." }),
  ).toBeVisible();
  await expect(page.locator(".import-success")).toContainText(
    "2 registros importados",
  );
  await page.getByRole("link", { name: "Conferir meus insumos" }).click();
  await expect(
    page.getByRole("link", { name: "Fertilizante NPK", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Semente de milho", exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Buscar produto" }).fill("Diesel");
  await expect(page.locator(".stock-table-scroll tbody tr")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Buscar produto" }).fill("");
  await page.screenshot({
    path: "../../tmp/phase3-inventory-desktop.png",
    fullPage: true,
  });
  const product = await db.product.findFirstOrThrow({
    where: { propertyId, name: "Diesel S10" },
  });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of [
      "/app/estoque",
      `/app/estoque/${product.id}`,
      "/app/movimentacoes",
      "/app/importar",
    ]) {
      await page.goto(route);
      await expect(page.locator(".stock-page-heading h1")).toBeVisible();
      await page.locator(".stock-loading").waitFor({ state: "hidden" });
      const bounds = await page.evaluate(() => ({
        ok: document.documentElement.scrollWidth <= innerWidth,
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        wide: [...document.querySelectorAll("body *")]
          .filter((e) => e.getBoundingClientRect().right > innerWidth)
          .slice(0, 12)
          .map((e) => ({
            tag: e.tagName,
            cls: e.className,
            right: e.getBoundingClientRect().right,
            scroll: e.scrollWidth,
            client: e.clientWidth,
          })),
      }));
      expect(bounds.ok, JSON.stringify({ route, ...bounds })).toBe(true);
      if (width === 390) await audit(page, route + " no celular");
      if (width === 390)
        await page.screenshot({
          path: `../../tmp/phase3-${route.includes(product.id) ? "product" : route.split("/").pop()}-mobile.png`,
          fullPage: true,
        });
    }
  }
  expect(errors).toEqual([]);
});

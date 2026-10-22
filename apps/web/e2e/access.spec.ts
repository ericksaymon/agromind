import { test, expect, type APIRequestContext } from "@playwright/test";
import { db } from "../../api/src/db";

const email = `e2e-phase2-${Date.now()}@example.test`;
const password = "Teste123";
const replacement = "Outra123";
async function actionLink(request: APIRequestContext, path: string) {
  for (let i = 0; i < 30; i++) {
    const list = await request.get("http://127.0.0.1:18025/api/v1/messages?limit=100").then(r => r.json());
    for (const message of list.messages.filter((m: { To: { Address: string }[] }) => m.To.some(to => to.Address === email))) {
      const body = await request.get(`http://127.0.0.1:18025/api/v1/message/${message.ID}`).then(r => r.json());
      const link = body.Text.match(new RegExp(`https?://[^\\s]+/${path}#token=[a-f0-9]{64}`));
      if (link) return link[0];
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Mensagem de teste não recebida na caixa local.");
}
test.afterAll(async () => {
  const user = await db.user.findUnique({ where: { email }, include: { memberships: true } });
  if (user) {
    await db.property.deleteMany({ where: { id: { in: user.memberships.map(m => m.propertyId) } } });
    await db.user.delete({ where: { id: user.id } });
  }
  await db.$disconnect();
});

test("jornada completa de acesso, confirmação, configuração e recuperação", async ({ page, request }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  page.on("console", message => { if (message.type() === "error" && /hydrat|didn.t match/i.test(message.text())) errors.push("Falha de hidratação no navegador."); });
  await page.goto("/app");
  await expect(page).toHaveURL(/\/entrar$/);
  await expect(page.getByRole("heading", { name: "Bom ter você de volta." })).toBeVisible();
  await page.screenshot({ path: "../../tmp/phase2-login-desktop.png" });
  await page.getByRole("link", { name: "Comece por aqui" }).click();
  await page.locator('[data-form-ready="true"]').waitFor();
  await page.getByLabel("Seu nome").fill("Maria do Campo");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Criar minha conta" }).click();
  await expect(page).toHaveURL(/\/verificar-email$/);
  await expect(page.locator(".verification-box")).toContainText(email);
  await page.screenshot({ path: "../../tmp/phase2-email.png" });
  await page.goto(await actionLink(request, "confirmar-email"));
  await page.locator('[data-form-ready="true"]').waitFor();
  await page.getByRole("button", { name: "Confirmar meu e-mail" }).click();
  await expect(page.getByRole("heading", { name: "E-mail confirmado", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Continuar", exact: true }).click();
  await expect(page).toHaveURL(/\/configuracao-inicial$/);
  await page.locator('[data-form-ready="true"]').waitFor();
  await page.getByLabel("Nome da propriedade").fill("Sítio Sementes do Amanhã");
  await page.getByLabel("Responsável", { exact: true }).fill("Maria do Campo");
  await page.getByLabel("Fuso horário").selectOption("America/Cuiaba");
  await page.getByLabel("Telefone", { exact: false }).fill("(69) 99999-9999");
  await page.screenshot({ path: "../../tmp/phase2-onboarding.png" });
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("region", { name: "Dados para preparar seu estoque" })).toBeVisible();
  await page.screenshot({ path: "../../tmp/phase2-start-options.png", fullPage: true });
  await page.getByRole("radio", { name: /Começar pelo cadastro/ }).check();
  await page.getByRole("button", { name: "Concluir configuração" }).click();
  await expect(page).toHaveURL(/\/app\/estoque$/);
  await expect(page.getByRole("heading", { name: "Meus insumos", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".real-app-header")).toContainText("Sítio Sementes do Amanhã");
  await page.getByRole("link", { name: "Visão geral", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Visão geral", exact: true })).toBeVisible();
  await expect(page.locator(".real-app-content")).not.toContainText("Fazenda Boa Vista");
  await page.screenshot({ path: "../../tmp/phase2-dashboard-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "../../tmp/phase2-dashboard-mobile.png" });
  await page.locator(".profile-menu > summary").click();
  await page.locator(".profile-menu").getByRole("button", { name: "Sair da conta", exact: true }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  await page.screenshot({ path: "../../tmp/phase2-login-mobile.png" });
  await page.goto("/app/importar"); await expect(page).toHaveURL(/\/entrar$/);
  await page.getByRole("link", { name: "Esqueci minha senha" }).click();
  await expect(page).toHaveURL(/\/recuperar-senha$/);
  await expect(page.getByRole("heading", { name: "Vamos recuperar seu acesso." })).toBeVisible();
  await page.locator('[data-form-ready="true"]').waitFor();
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Enviar link de recuperação" }).click();
  await expect(page.getByRole("heading", { name: "Confira seu e-mail", exact: true })).toBeVisible();
  const resetLink = await actionLink(request, "redefinir-senha");
  await page.goto(resetLink); await page.locator('[data-form-ready="true"]').waitFor();
  await page.getByLabel("Nova senha", { exact: true }).fill(replacement);
  await page.getByLabel("Confirme a nova senha").fill(replacement);
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(page.getByRole("heading", { name: "Sua senha foi atualizada" })).toBeVisible();
  await page.getByRole("link", { name: "Voltar para entrar" }).click();
  await page.locator('[data-form-ready="true"]').waitFor();
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(replacement);
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Visão geral", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("links ausentes e páginas de acesso são responsivos", async ({ page }) => {
  for (const route of ["/entrar", "/criar-conta", "/recuperar-senha", "/redefinir-senha", "/confirmar-email", "/termos", "/privacidade"]) {
    await page.setViewportSize({ width: 320, height: 900 }); await page.goto(route);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto("/redefinir-senha");
  await expect(page.getByRole("heading", { name: "Precisamos de um link válido" })).toBeVisible();
});

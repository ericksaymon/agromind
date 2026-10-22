import {
  test,
  expect,
  type Page,
  type BrowserContext,
  type APIRequestContext,
} from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import argon2 from "../../api/node_modules/argon2/argon2.cjs";
import { db } from "../../api/src/db";
import { safeReturnTo } from "../src/lib/auth-client";
const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex"),
  randomToken = () => randomBytes(32).toString("hex");
const users: string[] = [],
  properties: string[] = [],
  password = "Teste123",
  suffix = randomUUID();
const invitedEmail = `phase7-invited-${suffix}@example.test`;
let adminId: string, operatorId: string, viewerId: string, propertyId: string;
async function authenticate(context: BrowserContext, userId: string) {
  const token = randomToken();
  await db.session.create({
    data: {
      userId,
      tokenHash: digest(token),
      activePropertyId: propertyId,
      expiresAt: new Date(Date.now() + 86400_000),
    },
  });
  await context.addCookies([
    {
      name: "agromind_session",
      value: token,
      url: "http://localhost:3000",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
async function audit(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    r.violations.map((x) => ({
      id: x.id,
      nodes: x.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}
async function mailLink(
  request: APIRequestContext,
  email: string,
  route: string,
) {
  let link = "";
  await expect
    .poll(
      async () => {
        const list = await (
          await request.get("http://127.0.0.1:18025/api/v1/messages?limit=100")
        ).json();
        for (const item of list.messages.filter(
          (m: { To: { Address: string }[] }) =>
            m.To.some((t) => t.Address === email),
        )) {
          const body = await (
            await request.get(
              `http://127.0.0.1:18025/api/v1/message/${item.ID}`,
            )
          ).json();
          const match = (body.Text as string).match(
            new RegExp(`http://localhost:3000/${route}#token=[a-f0-9]{64}`),
          );
          if (match) {
            link = match[0];
            return true;
          }
        }
        return false;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  return link;
}
test.beforeAll(async () => {
  const hash = await argon2.hash(password);
  for (const [name, email] of [
    ["Administrador sintético", `phase7-admin-${suffix}@example.test`],
    ["Operador sintético", `phase7-operator-${suffix}@example.test`],
    ["Consulta sintética", `phase7-viewer-${suffix}@example.test`],
  ]) {
    const u = await db.user.create({
      data: { name, email, passwordHash: hash, emailVerifiedAt: new Date() },
    });
    users.push(u.id);
  }
  [adminId, operatorId, viewerId] = users;
  const p = await db.property.create({
    data: {
      name: "Fazenda de homologação etapa 7",
      responsible: "Pessoa sintética",
      timezone: "America/Cuiaba",
      startMethod: "MANUAL",
      memberships: {
        create: [
          { userId: adminId, role: "ADMIN" },
          { userId: operatorId, role: "OPERATOR" },
          { userId: viewerId, role: "VIEWER" },
        ],
      },
    },
  });
  propertyId = p.id;
  properties.push(p.id);
});
test.afterAll(async () => {
  const invited = await db.user.findUnique({ where: { email: invitedEmail } });
  if (invited) users.push(invited.id);
  await db.administrativeEvent.deleteMany({
    where: {
      OR: [{ userId: { in: users } }, { propertyId: { in: properties } }],
    },
  });
  await db.property.deleteMany({ where: { id: { in: properties } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});
test("configurações: propriedade, catálogo, equipe, conta e acessibilidade em quatro larguras", async ({
  page,
  context,
}) => {
  await authenticate(context, adminId);
  page.on("dialog", (d) => d.accept());
  await page.goto("/app/configuracoes");
  await expect(
    page.getByRole("heading", { name: "Dados da propriedade" }),
  ).toBeVisible();
  await page
    .getByLabel("Nome da propriedade")
    .fill("Fazenda atualizada na homologação");
  await page
    .getByLabel("Motivo", { exact: true })
    .fill("Atualização sintética de cadastro");
  await page
    .getByRole("button", { name: "Salvar propriedade", exact: true })
    .click();
  await expect(page.locator(".settings-notice")).toContainText(
    "Propriedade atualizada",
  );
  await page.getByRole("button", { name: "Categorias", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Catálogo de categorias" }),
  ).toBeVisible();
  await page.getByLabel("Nova categoria").fill("Categoria da homologação");
  await page
    .getByLabel("Motivo", { exact: true })
    .first()
    .fill("Criação sintética de categoria");
  await page
    .getByRole("button", { name: "Criar categoria", exact: true })
    .click();
  await expect(page.locator(".settings-notice")).toContainText(
    "Categoria criada",
  );
  await expect(
    page.getByLabel("Nome da categoria Categoria da homologação"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Equipe e convites", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Equipe", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Operador sintético", { exact: true }),
  ).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await audit(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: fileURLToPath(
      new URL("../../../tmp/phase7-settings.png", import.meta.url),
    ),
    fullPage: true,
  });
  await page.goto("/conta");
  await expect(
    page.getByRole("heading", { name: "Sessões de acesso" }),
  ).toBeVisible();
  await expect(page.getByText("Esta sessão", { exact: true })).toBeVisible();
  await audit(page);
  const profile = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Seu nome", exact: true }),
  });
  await profile
    .getByLabel("Nome", { exact: true })
    .fill("Nome atualizado na homologação");
  await profile.getByRole("button", { name: "Salvar nome" }).click();
  await expect(page.locator(".settings-notice")).toContainText(
    "Nome atualizado",
  );
});
test("consulta não vê e-mails administrativos e usa categorias somente para leitura", async ({
  page,
  context,
}) => {
  await authenticate(context, viewerId);
  await page.goto("/app/configuracoes");
  await expect(
    page.getByRole("heading", { name: "Dados da propriedade" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Equipe e convites" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Salvar propriedade" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Categorias", exact: true }).click();
  await expect(page.getByText("Combustíveis", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Criar categoria" }),
  ).toHaveCount(0);
  await audit(page);
});
test("convite completo: Mailpit, cadastro sem fazenda, confirmação e aceite explícito", async ({
  browser,
  request,
}) => {
  const admin = await browser.newContext(),
    adminPage = await admin.newPage();
  await authenticate(admin, adminId);
  adminPage.on("dialog", (d) => d.accept());
  await adminPage.goto("/app/configuracoes");
  await adminPage
    .getByRole("button", { name: "Equipe e convites", exact: true })
    .click();
  const form = adminPage
    .locator("form")
    .filter({ has: adminPage.getByLabel("E-mail", { exact: true }) });
  await form.getByLabel("E-mail", { exact: true }).fill(invitedEmail);
  await form
    .getByLabel("Motivo", { exact: true })
    .fill("Convite sintético de homologação");
  await form.getByRole("button", { name: "Enviar convite" }).click();
  await expect(adminPage.locator(".settings-notice")).toContainText(
    "Convite colocado na fila",
  );
  const invitedProperty = await db.property.findUniqueOrThrow({
    where: { id: propertyId },
  });
  const link = await mailLink(request, invitedEmail, "convite"),
    invited = await browser.newContext(),
    page = await invited.newPage();
  await page.goto(link);
  await expect(
    page.getByRole("heading", { name: "Fazenda atualizada na homologação" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/convite$/);
  await page.getByRole("link", { name: "Criar conta para aceitar" }).click();
  await page.locator('[data-form-ready="true"]').waitFor();
  await page.getByLabel("Seu nome").fill("Destinatário sintético");
  await page.getByLabel("E-mail", { exact: true }).fill(invitedEmail);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Criar minha conta" }).click();
  await expect(page).toHaveURL(/\/verificar-email$/);
  await page.goto(await mailLink(request, invitedEmail, "confirmar-email"));
  await page.locator('[data-form-ready="true"]').waitFor();
  await page.getByRole("button", { name: "Confirmar meu e-mail" }).click();
  await page.getByRole("link", { name: "Continuar", exact: true }).click();
  await expect(page).toHaveURL(/\/convite$/);
  await page
    .getByRole("button", { name: "Aceitar acesso à propriedade" })
    .click();
  await expect(page).toHaveURL(/\/app$/);
  const user = await db.user.findUniqueOrThrow({
    where: { email: invitedEmail },
  });
  expect(await db.membership.count({ where: { userId: user.id } })).toBe(1);
  expect(
    (
      await db.membership.findUniqueOrThrow({
        where: { userId_propertyId: { userId: user.id, propertyId } },
      })
    ).role,
  ).toBe("OPERATOR");
  await invited.close();
  await admin.close();
});

test("conta: confirma e-mail antigo e novo, encerra a sessão e permite entrar com o novo endereço", async ({
  page,
  context,
  request,
}) => {
  await authenticate(context, adminId);
  await page.goto("/conta");
  await expect(
    page.getByRole("heading", { name: "E-mail da conta" }),
  ).toBeVisible();
  const old = (await db.user.findUniqueOrThrow({ where: { id: adminId } }))
      .email,
    next = `phase7-new-${suffix}@example.test`;
  const section = page.locator("section").filter({
    has: page.getByRole("heading", { name: "E-mail da conta", exact: true }),
  });
  await section.getByLabel("Novo e-mail").fill(next);
  await section.getByLabel("Senha atual").fill(password);
  await section
    .getByRole("button", { name: "Solicitar alteração de e-mail" })
    .click();
  await expect(page.locator(".settings-notice")).toContainText(
    "Confirmações colocadas na fila",
  );
  const confirmation = async (email: string) => {
    let link = "";
    await expect
      .poll(
        async () => {
          const list = await (
            await request.get(
              "http://127.0.0.1:18025/api/v1/messages?limit=100",
            )
          ).json();
          for (const m of list.messages.filter(
            (x: { To: { Address: string }[] }) =>
              x.To.some((t) => t.Address === email),
          )) {
            const body = await (
              await request.get(`http://127.0.0.1:18025/api/v1/message/${m.ID}`)
            ).json();
            const match = (body.Text as string).match(
              /http:\/\/localhost:3000\/conta#emailToken=[a-f0-9]{64}/,
            );
            if (match) {
              link = match[0];
              return true;
            }
          }
          return false;
        },
        { timeout: 15000 },
      )
      .toBe(true);
    return link;
  };
  await page.goto(await confirmation(old));
  await page.getByRole("button", { name: "Confirmar este endereço" }).click();
  await expect(page.locator(".settings-notice")).toContainText(
    "Endereço confirmado",
  );
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: adminId } })).email,
  ).toBe(old);
  await page.goto(await confirmation(next));
  await page.getByRole("button", { name: "Confirmar este endereço" }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  await page.locator('[data-form-ready="true"]').waitFor();
  await page.getByLabel("E-mail", { exact: true }).fill(next);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();
  await expect(page).toHaveURL(/\/app$/);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: adminId } })).email,
  ).toBe(next);
});

test("formulário alterado permite cancelar navegação; resposta antiga de outra aba é ignorada", async ({
  page,
  context,
}) => {
  await authenticate(context, adminId);
  await page.goto("/app/configuracoes");
  await expect(page.getByLabel("Nome da propriedade")).toBeVisible();
  const original = await page.getByLabel("Nome da propriedade").inputValue();
  await page.getByLabel("Nome da propriedade").fill("Edição ainda não salva");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Sair da conta" }).click();
  await expect(page.getByLabel("Nome da propriedade")).toHaveValue(
    "Edição ainda não salva",
  );
  const identity = await page.request.get("/api/auth/me");
  expect(identity.status()).toBe(200);
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Categorias", exact: true }).click();
  await expect(page.getByLabel("Nome da propriedade")).toHaveValue(
    "Edição ainda não salva",
  );
  await page.getByLabel("Nome da propriedade").fill(original);
  await page
    .getByLabel("Motivo", { exact: true })
    .fill("Cancelar edição sintética sem mudar dados");
  await page
    .getByRole("button", { name: "Salvar propriedade", exact: true })
    .click();
  await expect(page.locator(".settings-notice")).toContainText(
    "Propriedade atualizada",
  );
  let release!: () => void, entered!: () => void;
  const barrier = new Promise<void>((r) => {
      release = r;
    }),
    started = new Promise<void>((r) => {
      entered = r;
    });
  await page.route(
    `**/api/properties/${propertyId}/categories?page=1*`,
    async (route) => {
      entered();
      await barrier;
      await route.continue();
    },
  );
  await page.getByRole("button", { name: "Categorias", exact: true }).click();
  await started;
  await page
    .getByRole("button", { name: "Equipe e convites", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Equipe", exact: true }),
  ).toBeVisible();
  const response = page.waitForResponse((r) =>
    r.url().includes("/categories?page=1"),
  );
  release();
  await response;
  await page.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      ),
  );
  await expect(
    page.getByText("Operador sintético", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Catálogo de categorias" }),
  ).toHaveCount(0);
});

test("destinos de autenticação rejeitam hosts externos, esquemas, tokens e caminhos não autorizados", () => {
  expect(safeReturnTo("/convite")).toBe("/convite");
  expect(safeReturnTo("/conta")).toBe("/conta");
  for (const value of [
    null,
    "",
    "https://example.test",
    "//example.test",
    "javascript:alert(1)",
    "/\\example.test",
    "%2F%2Fexample.test",
    "/convite?token=secret",
    "/conta#emailToken=secret",
    "/convite/../app",
    " /convite",
    "/Convite",
    "/app",
  ]) {
    expect(safeReturnTo(value)).toBe(null);
  }
});

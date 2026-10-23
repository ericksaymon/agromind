import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { buildApp } from "../src/app";
import { db } from "../src/db";
import { digest, randomToken, sessionCookie } from "../src/security";
import { settings } from "../src/config";
import { decryptMail, processOutbox } from "../src/mail-outbox";
import { locked, createProduct, dayInZone } from "../src/stock-service";
const ids: string[] = [],
  properties: string[] = [],
  password = "Teste123";
let app: Awaited<ReturnType<typeof buildApp>>, hash: string;
class Client {
  cookie = "";
  csrf = "";
  sessionId = "";
  constructor(
    public userId: string,
    public email: string,
  ) {}
  async init() {
    const token = randomToken();
    const s = await db.session.create({
      data: {
        userId: this.userId,
        tokenHash: digest(token),
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
    this.sessionId = s.id;
    this.cookie = `${sessionCookie}=${token}`;
    const r = await this.get("/api/auth/csrf");
    this.csrf = r.json().token;
    this.cookie += `; ${r.cookies[0].name}=${r.cookies[0].value}`;
    return this;
  }
  get(url: string) {
    return app.inject({ method: "GET", url, headers: { cookie: this.cookie } });
  }
  post(url: string, payload: unknown) {
    return app.inject({
      method: "POST",
      url,
      payload: payload as object,
      headers: {
        cookie: this.cookie,
        origin: settings.origin,
        "x-csrf-token": this.csrf,
      },
    });
  }
  async reauth() {
    const r = await this.post("/api/account/reauthenticate", { password });
    assert.equal(r.statusCode, 200, r.body);
  }
}
async function user(name = "Pessoa sintética") {
  const email = `admin7-${randomUUID()}@example.test`;
  const u = await db.user.create({
    data: { name, email, passwordHash: hash, emailVerifiedAt: new Date() },
  });
  ids.push(u.id);
  return new Client(u.id, email).init();
}
async function fixture() {
  const a = await user("Administrador sintético"),
    o = await user("Operador sintético"),
    v = await user("Consulta sintética"),
    other = await user("Pessoa externa");
  const p = await db.property.create({
    data: {
      name: "Propriedade sintética etapa 7",
      responsible: "Teste",
      timezone: "America/Cuiaba",
      startMethod: "MANUAL",
      memberships: {
        create: [
          { userId: a.userId, role: "ADMIN" },
          { userId: o.userId, role: "OPERATOR" },
          { userId: v.userId, role: "VIEWER" },
        ],
      },
    },
  });
  properties.push(p.id);
  return { a, o, v, other, p, base: `/api/properties/${p.id}` };
}
const intent = () => ({
  key: randomUUID(),
  reason: "Validação sintética da etapa 7",
});
before(async () => {
  hash = await argon2.hash(password);
  app = await buildApp({ test: true });
});
after(async () => {
  await db.administrativeEvent.deleteMany({ where: { userId: { in: ids } } });
  await db.property.deleteMany({ where: { id: { in: properties } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await app.close();
  await db.$disconnect();
});

test("administração: papéis, escopo, CSRF, vínculo sem default privilegiado e endpoint antigo fechado", async () => {
  const { a, o, v, other, p, base } = await fixture();
  for (const path of ["/members", "/invitations", "/audit"]) {
    assert.equal((await a.get(base + path)).statusCode, 200);
    assert.equal((await o.get(base + path)).statusCode, 403);
    assert.equal((await v.get(base + path)).statusCode, 403);
    assert.equal((await other.get(base + path)).statusCode, 404);
  }
  assert.equal((await v.get(base + "/categories")).statusCode, 200);
  assert.equal((await v.get(base + "/analysis/team")).statusCode, 403);
  const m = await db.membership.create({
    data: { propertyId: p.id, userId: other.userId },
  });
  assert.equal(m.role, "VIEWER");
  assert.equal(
    (await o.post(base + "/categories", { ...intent(), name: "Teste" }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: base + "/categories",
        payload: { ...intent(), name: "Teste" },
        headers: { cookie: a.cookie },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: base,
        payload: { ...p, name: "Bypass" },
        headers: {
          cookie: a.cookie,
          origin: settings.origin,
          "x-csrf-token": a.csrf,
        },
      })
    ).statusCode,
    404,
  );
});
test("propriedade: versão, no-op, idempotência, fuso explícito e cobertura histórica preservada", async () => {
  const { a, p, base } = await fixture();
  const product = await db.product.create({
    data: {
      propertyId: p.id,
      name: "Diesel",
      nameKey: "diesel",
      category: "Combustíveis",
      unit: "L",
      coverageStart: new Date("2026-01-01"),
      coverageEnd: new Date("2026-02-01"),
      coverageOngoing: true,
      coverageConfirmedBy: a.userId,
    },
  });
  const body = {
    ...intent(),
    version: 1,
    name: p.name,
    responsible: p.responsible,
    timezone: p.timezone,
    phone: "",
  };
  assert.equal((await a.post(base + "/settings", body)).statusCode, 200);
  assert.equal(
    (await db.property.findUniqueOrThrow({ where: { id: p.id } }))
      .settingsVersion,
    1,
  );
  const changed = { ...body, ...intent(), name: "Novo nome" };
  assert.equal((await a.post(base + "/settings", changed)).statusCode, 200);
  assert.equal((await a.post(base + "/settings", changed)).statusCode, 200);
  assert.equal(
    (await a.post(base + "/settings", { ...changed, name: "Outro" }))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await a.post(base + "/settings", {
        ...body,
        ...intent(),
        name: "Desatualizado",
      })
    ).statusCode,
    409,
  );
  let current = await db.property.findUniqueOrThrow({ where: { id: p.id } });
  assert.equal(current.inventoryRevision, 0);
  const tz = {
    ...body,
    ...intent(),
    name: "Novo nome",
    version: 2,
    timezone: "America/Sao_Paulo",
  };
  assert.equal((await a.post(base + "/settings", tz)).statusCode, 400);
  assert.equal(
    (await a.post(base + "/settings", { ...tz, confirmTimezone: true }))
      .statusCode,
    200,
  );
  current = await db.property.findUniqueOrThrow({ where: { id: p.id } });
  assert.equal(current.inventoryRevision, 1);
  assert(current.analysisPending);
  const fresh = await db.product.findUniqueOrThrow({
    where: { id: product.id },
  });
  assert.equal(fresh.coverageStart, null);
  assert.equal(fresh.coverageEnd, null);
  assert.equal(fresh.coverageOngoing, false);
  assert.equal(fresh.coverageConfirmedBy, null);
  const events = await db.administrativeEvent.findMany({
    where: { propertyId: p.id },
  });
  assert.equal(events.length, 2);
  assert.match(JSON.stringify(events), /2026-01-01/);
});
test("propriedade adicional: replay e concorrência criam um único vínculo ADMIN explícito", async () => {
  const a = await user();
  const b = {
    ...intent(),
    name: "Outra fazenda",
    responsible: "Responsável",
    timezone: "America/Cuiaba",
    startMethod: "MANUAL",
  };
  const responses = await Promise.all([
    a.post("/api/account/properties", b),
    a.post("/api/account/properties", b),
  ]);
  assert(responses.every((r) => r.statusCode === 200));
  assert.equal(responses[0].json().id, responses[1].json().id);
  properties.push(responses[0].json().id);
  assert.equal(
    (await a.post("/api/account/properties", { ...b, name: "Outro conteúdo" }))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await db.membership.findUniqueOrThrow({
        where: {
          userId_propertyId: {
            userId: a.userId,
            propertyId: properties.at(-1)!,
          },
        },
      })
    ).role,
    "ADMIN",
  );
});
test("último administrador: reautenticação, promoção e duas saídas concorrentes preservam um ADMIN", async () => {
  const { a, o, p, base } = await fixture();
  assert.equal(
    (
      await a.post(`${base}/members/${o.userId}`, {
        ...intent(),
        version: 1,
        role: "ADMIN",
      })
    ).json().code,
    "REAUTH_REQUIRED",
  );
  await a.reauth();
  assert.equal(
    (
      await a.post(`${base}/members/${a.userId}`, {
        ...intent(),
        version: 1,
        role: "REMOVE",
      })
    ).json().code,
    "LAST_ADMIN",
  );
  assert.equal(
    (
      await a.post(`${base}/members/${o.userId}`, {
        ...intent(),
        version: 1,
        role: "ADMIN",
      })
    ).statusCode,
    200,
  );
  await o.reauth();
  const race = await Promise.all([
    a.post(`${base}/members/${a.userId}`, {
      ...intent(),
      version: 1,
      role: "REMOVE",
    }),
    o.post(`${base}/members/${o.userId}`, {
      ...intent(),
      version: 2,
      role: "REMOVE",
    }),
  ]);
  assert.deepEqual(race.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(
    await db.membership.count({ where: { propertyId: p.id, role: "ADMIN" } }),
    1,
  );
});
test("remoção e rebaixamento limpam responsáveis ativos sem encerrar risco ou apagar história", async () => {
  const { a, o, p, base } = await fixture();
  const active = await db.alertOccurrence.create({
    data: {
      propertyId: p.id,
      identity: randomUUID(),
      productId: randomUUID(),
      rule: "MINIMUM",
      priority: "HIGH",
      evidence: {},
      assigneeId: o.userId,
      assigneeName: "Operador",
    },
  });
  const closed = await db.alertOccurrence.create({
    data: {
      propertyId: p.id,
      identity: randomUUID(),
      productId: randomUUID(),
      rule: "MINIMUM",
      priority: "HIGH",
      evidence: {},
      assigneeId: o.userId,
      assigneeName: "Operador",
      closedAt: new Date(),
    },
  });
  assert.equal(
    (
      await a.post(`${base}/members/${o.userId}`, {
        ...intent(),
        version: 1,
        role: "VIEWER",
      })
    ).statusCode,
    200,
  );
  const updated = await db.alertOccurrence.findUniqueOrThrow({
    where: { id: active.id },
  });
  assert.equal(updated.assigneeId, null);
  assert.equal(updated.actionVersion, 1);
  assert.equal(updated.closedAt, null);
  assert.equal(
    (await db.alertOccurrence.findUniqueOrThrow({ where: { id: closed.id } }))
      .assigneeId,
    o.userId,
  );
  assert.equal(
    (
      await o.post(base + "/products", {
        key: randomUUID(),
        revision: 0,
        name: "Produto",
        category: "Outros",
        unit: "L",
        minimum: "0",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await a.post(`${base}/members/${o.userId}`, {
        ...intent(),
        version: 2,
        role: "REMOVE",
      })
    ).statusCode,
    200,
  );
  assert.equal((await o.get(base)).statusCode, 404);
  assert.equal((await o.get("/api/account")).statusCode, 200);
});
test("catálogo: normalização, versão, renomear projeção, arquivar e isolamento de FK", async () => {
  const { a, o, p, base } = await fixture(),
    second = await fixture();
  const creation = await a.post(base + "/categories", {
    ...intent(),
    name: "Categoria Ágil",
  });
  assert.equal(creation.statusCode, 200);
  const id = creation.json().id;
  assert.equal(
    (
      await a.post(base + "/categories", {
        ...intent(),
        name: "categoria-agil",
      })
    ).statusCode,
    409,
  );
  const product = await db.product.create({
    data: {
      propertyId: p.id,
      categoryId: id,
      category: "Categoria Ágil",
      name: "Teste de categoria",
      nameKey: "teste",
      unit: "L",
    },
  });
  assert.equal(
    (
      await a.post(`${base}/categories/${id}`, {
        ...intent(),
        version: 1,
        name: "Renomeada",
        archived: false,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await db.product.findUniqueOrThrow({ where: { id: product.id } }))
      .category,
    "Renomeada",
  );
  assert.equal(
    (
      await a.post(`${base}/categories/${id}`, {
        ...intent(),
        version: 1,
        name: "Obsoleta",
        archived: false,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await a.post(`${base}/categories/${id}`, {
        ...intent(),
        version: 2,
        name: "Renomeada",
        archived: true,
      })
    ).statusCode,
    200,
  );
  const revision = (await a.get(base + "/inventory")).json().revision;
  assert.equal(
    (
      await o.post(base + "/products", {
        key: randomUUID(),
        revision,
        name: "Outra",
        category: "Renomeada",
        categoryId: id,
        unit: "L",
        minimum: "0",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await o.post(base + "/products", {
        key: randomUUID(),
        revision,
        name: "Outra",
        category: "Inexistente",
        unit: "L",
        minimum: "0",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await o.post(`${base}/products/${product.id}/update`, {
        key: randomUUID(),
        revision,
        name: "Teste atualizado",
        category: "Renomeada",
        categoryId: id,
        unit: "L",
        minimum: "0",
      })
    ).statusCode,
    200,
  );
  await assert.rejects(
    db.product.create({
      data: {
        propertyId: second.p.id,
        categoryId: id,
        category: "Renomeada",
        name: "Invasor",
        nameKey: "invasor",
        unit: "L",
      },
    }),
  );
});
test("conta sem propriedade: perfil versionado e nome histórico imutável", async () => {
  const a = await user("Nome original");
  const profile = await a.get("/api/account");
  assert.equal(profile.statusCode, 200);
  assert.deepEqual(profile.json().memberships, []);
  assert.equal(
    (await a.post("/api/account/profile", { name: "Nome novo", version: 1 }))
      .statusCode,
    200,
  );
  assert.equal(
    (await a.post("/api/account/profile", { name: "Conflito", version: 1 }))
      .statusCode,
    409,
  );
  const event = await db.administrativeEvent.findFirstOrThrow({
    where: { userId: a.userId, kind: "PROFILE_CHANGED" },
  });
  assert.equal(event.actorName, "Nome original");
  assert.equal((await a.get("/api/account")).json().name, "Nome novo");
});
test("senha: política preservada, senha atual e revogação total de sessões e tokens", async () => {
  const a = await user(),
    otherSession = await new Client(a.userId, a.email).init();
  assert.equal(
    (
      await a.post("/api/account/password", {
        currentPassword: password,
        password: "abcdefgh",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await a.post("/api/account/password", {
        currentPassword: password,
        password,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await a.post("/api/account/password", {
        currentPassword: "errada",
        password: "Outra123",
      })
    ).statusCode,
    400,
  );
  const token = await db.actionToken.create({
    data: {
      userId: a.userId,
      kind: "RESET_PASSWORD",
      tokenHash: digest(randomToken()),
      expiresAt: new Date(Date.now() + 10000),
    },
  });
  assert.equal(
    (
      await a.post("/api/account/password", {
        currentPassword: password,
        password: "Outra123",
      })
    ).statusCode,
    200,
  );
  assert.equal((await a.get("/api/account")).statusCode, 401);
  assert.equal((await otherSession.get("/api/account")).statusCode, 401);
  assert(
    (await db.actionToken.findUniqueOrThrow({ where: { id: token.id } }))
      .usedAt,
  );
  assert.equal(
    (await a.post("/api/auth/login", { email: a.email, password })).statusCode,
    401,
  );
  assert.equal(
    (await a.post("/api/auth/login", { email: a.email, password: "Outra123" }))
      .statusCode,
    200,
  );
});
test("sessões: revogar apenas as próprias, repetir sem efeito e preservar sessão atual", async () => {
  const a = await user(),
    other = await user(),
    second = await new Client(a.userId, a.email).init();
  assert.equal(
    (await a.post("/api/account/sessions/revoke", { id: other.sessionId }))
      .statusCode,
    404,
  );
  assert.equal(
    (await a.post("/api/account/sessions/revoke", { id: second.sessionId }))
      .statusCode,
    200,
  );
  assert.equal(
    (await a.post("/api/account/sessions/revoke", { id: second.sessionId }))
      .statusCode,
    200,
  );
  assert.equal((await second.get("/api/account")).statusCode, 401);
  assert.equal((await a.get("/api/account")).statusCode, 200);
});
test("e-mail: dupla confirmação por propósitos distintos, token cifrado e encerramento das sessões", async () => {
  const a = await user(),
    target = `new-${randomUUID()}@example.test`;
  assert.equal(
    (
      await a.post("/api/account/email", {
        email: target,
        currentPassword: password,
        version: 1,
      })
    ).statusCode,
    200,
  );
  const change = await db.emailChangeRequest.findFirstOrThrow({
    where: { userId: a.userId, status: "PENDING" },
  });
  const jobs = await db.mailOutbox.findMany({
    where: { intent: { startsWith: change.id } },
  });
  assert.equal(jobs.length, 2);
  assert(jobs.every((j) => !j.encrypted.includes(target)));
  const envelopes = jobs.map((j) => decryptMail(j.encrypted)),
    old = envelopes.find((x) => x.to === a.email)!,
    fresh = envelopes.find((x) => x.to === target)!;
  const oldToken = old.text.match(/emailToken=([a-f0-9]{64})/)![1],
    newToken = fresh.text.match(/emailToken=([a-f0-9]{64})/)![1];
  assert.equal(
    (await a.post("/api/account/email/confirm", { token: oldToken })).json()
      .loginRequired,
    false,
  );
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: a.userId } })).email,
    a.email,
  );
  assert.equal(
    (await a.post("/api/account/email/confirm", { token: newToken })).json()
      .loginRequired,
    true,
  );
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: a.userId } })).email,
    target,
  );
  assert.equal((await a.get("/api/account")).statusCode, 401);
  await db.mailOutbox.deleteMany({
    where: { intent: { startsWith: change.id } },
  });
});
test("e-mail cancelado, expirado e confirmação por outra conta não mudam o endereço", async () => {
  const a = await user(),
    other = await user();
  assert.equal(
    (
      await a.post("/api/account/email", {
        email: `new-${randomUUID()}@example.test`,
        currentPassword: password,
        version: 1,
      })
    ).statusCode,
    200,
  );
  const change = await db.emailChangeRequest.findFirstOrThrow({
      where: { userId: a.userId, status: "PENDING" },
    }),
    job = await db.mailOutbox.findFirstOrThrow({
      where: { intent: `${change.id}:old` },
    }),
    token = decryptMail(job.encrypted).text.match(
      /emailToken=([a-f0-9]{64})/,
    )![1];
  assert.equal(
    (await other.post("/api/account/email/confirm", { token })).statusCode,
    410,
  );
  assert.equal((await a.post("/api/account/email/cancel", {})).statusCode, 200);
  assert.equal(
    (await a.post("/api/account/email/confirm", { token })).statusCode,
    410,
  );
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: a.userId } })).email,
    a.email,
  );
  await db.mailOutbox.deleteMany({
    where: { intent: { startsWith: change.id } },
  });
});
test("convite: fila cifrada, processamento, aceite por e-mail verificado e replay sem novo vínculo", async () => {
  const { a, other, p, base } = await fixture();
  const b = { ...intent(), email: other.email, role: "OPERATOR" };
  const created = await a.post(base + "/invitations", b);
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().id;
  const job = await db.mailOutbox.findFirstOrThrow({
      where: { invitationId: id },
    }),
    envelope = decryptMail(job.encrypted),
    token = envelope.text.match(/#token=([a-f0-9]{64})/)![1];
  assert(!job.encrypted.includes(token));
  assert.equal(
    (await other.post("/api/invitations/preview", { token })).json().code,
    "INVITE_PROCESSING",
  );
  // Select only this synthetic intent; no actual SMTP delivery in this test.
  await db.mailOutbox.update({
    where: { id: job.id },
    data: { nextAttemptAt: new Date(0) },
  });
  await processOutbox(async (message) => {
    assert.equal(message.to, other.email);
  }, job.id);
  assert.equal(
    (await other.post("/api/invitations/preview", { token })).statusCode,
    200,
  );
  assert.equal(
    (await a.post("/api/invitations/accept", { token })).statusCode,
    403,
  );
  await db.user.update({
    where: { id: other.userId },
    data: { emailVerifiedAt: null },
  });
  assert.equal(
    (await other.post("/api/invitations/accept", { token })).statusCode,
    403,
  );
  await db.user.update({
    where: { id: other.userId },
    data: { emailVerifiedAt: new Date() },
  });
  const accepted = await other.post("/api/invitations/accept", { token });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(
    (await other.post("/api/invitations/accept", { token })).json()
      .alreadyAccepted,
    true,
  );
  assert.equal(
    (
      await db.membership.findUniqueOrThrow({
        where: {
          userId_propertyId: { userId: other.userId, propertyId: p.id },
        },
      })
    ).role,
    "OPERATOR",
  );
  assert.equal((await a.post(base + "/invitations", b)).statusCode, 200);
  assert.equal(
    (await db.mailOutbox.findUniqueOrThrow({ where: { id: job.id } }))
      .encrypted,
    "",
  );
});
test("revogação durante SMTP não ressuscita convite; emissor sem ADMIN não concede acesso", async () => {
  const { a, other, base, p } = await fixture();
  const created = await a.post(base + "/invitations", {
    ...intent(),
    email: other.email,
    role: "VIEWER",
  });
  const id = created.json().id,
    job = await db.mailOutbox.findFirstOrThrow({ where: { invitationId: id } }),
    token = decryptMail(job.encrypted).text.match(/#token=([a-f0-9]{64})/)![1];
  await db.mailOutbox.update({
    where: { id: job.id },
    data: { nextAttemptAt: new Date(0) },
  });
  await processOutbox(async () => {
    const current = await db.invitation.findUniqueOrThrow({ where: { id } });
    assert.equal(
      (
        await a.post(`${base}/invitations/${id}`, {
          ...intent(),
          version: current.version,
          action: "REVOKE",
        })
      ).statusCode,
      200,
    );
  }, job.id);
  assert.equal(
    (await db.invitation.findUniqueOrThrow({ where: { id } })).status,
    "REVOKED",
  );
  assert.equal(
    (await other.post("/api/invitations/accept", { token })).statusCode,
    410,
  );
  assert.equal(
    await db.membership.count({
      where: { userId: other.userId, propertyId: p.id },
    }),
    0,
  );
});

test("sessão e papel são revalidados dentro da escrita, após a captura original do ator", async () => {
  const { a, o, p } = await fixture();
  const actor = {
    userId: o.userId,
    name: "Nome capturado",
    sessionId: o.sessionId,
    propertyId: p.id,
    role: "OPERATOR",
    timezone: p.timezone,
  };
  await db.membership.update({
    where: { userId_propertyId: { userId: o.userId, propertyId: p.id } },
    data: { role: "VIEWER" },
  });
  await assert.rejects(
    locked(actor, async () => true),
    (e: unknown) => (e as { statusCode: number }).statusCode === 403,
  );
  await db.session.delete({ where: { id: a.sessionId } });
  await assert.rejects(
    locked(
      { ...actor, userId: a.userId, sessionId: a.sessionId, role: "ADMIN" },
      async () => true,
    ),
    (e: unknown) => (e as { statusCode: number }).statusCode === 401,
  );
});
test("remoção mantém outro vínculo e seleciona a propriedade remanescente sem logout global", async () => {
  const { a, o, p, base } = await fixture();
  const other = await db.property.create({
    data: {
      name: "Outro acesso sintético",
      responsible: "Teste",
      timezone: p.timezone,
      startMethod: "MANUAL",
      memberships: { create: { userId: o.userId, role: "ADMIN" } },
    },
  });
  properties.push(other.id);
  await db.session.update({
    where: { id: o.sessionId },
    data: { activePropertyId: p.id },
  });
  assert.equal(
    (
      await a.post(`${base}/members/${o.userId}`, {
        ...intent(),
        version: 1,
        role: "REMOVE",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await db.session.findUniqueOrThrow({ where: { id: o.sessionId } }))
      .activePropertyId,
    other.id,
  );
  assert.equal((await o.get("/api/auth/me")).json().property.id, other.id);
});
test("reauth vencida ou em outra sessão não concede poderes administrativos", async () => {
  const { a, o, base } = await fixture();
  await a.reauth();
  await db.session.update({
    where: { id: a.sessionId },
    data: { reauthenticatedAt: new Date(Date.now() - 300001) },
  });
  const b = { ...intent(), version: 1, role: "ADMIN" };
  assert.equal(
    (await a.post(`${base}/members/${o.userId}`, b)).json().code,
    "REAUTH_REQUIRED",
  );
  await a.reauth();
  const second = await new Client(a.userId, a.email).init();
  assert.equal(
    (await second.post(`${base}/members/${o.userId}`, b)).json().code,
    "REAUTH_REQUIRED",
  );
});
test("convites: duplicidade concorrente, limites por alvo, validade exata e permissão do emissor", async () => {
  const { a, o, other, p, base } = await fixture();
  const b = { ...intent(), email: other.email, role: "VIEWER" };
  const race = await Promise.all([
    a.post(base + "/invitations", b),
    a.post(base + "/invitations", { ...b, key: randomUUID() }),
  ]);
  assert.deepEqual(race.map((r) => r.statusCode).sort(), [200, 409]);
  const id = race.find((r) => r.statusCode === 200)!.json().id,
    job = await db.mailOutbox.findFirstOrThrow({ where: { invitationId: id } }),
    token = decryptMail(job.encrypted).text.match(/#token=([a-f0-9]{64})/)![1];
  await db.mailOutbox.update({
    where: { id: job.id },
    data: { nextAttemptAt: new Date(0) },
  });
  await processOutbox(async () => {}, job.id);
  const current = await db.invitation.findUniqueOrThrow({ where: { id } });
  assert.equal(
    (
      await a.post(`${base}/invitations/${id}`, {
        ...intent(),
        version: current.version,
        action: "RESEND",
      })
    ).statusCode,
    429,
  );
  await db.invitation.update({
    where: { id },
    data: { expiresAt: new Date() },
  });
  assert.equal(
    (await other.post("/api/invitations/accept", { token })).statusCode,
    410,
  );
  await db.invitation.update({
    where: { id },
    data: { expiresAt: new Date(Date.now() + 60000) },
  });
  await db.membership.update({
    where: { userId_propertyId: { userId: a.userId, propertyId: p.id } },
    data: { role: "OPERATOR" },
  });
  assert.equal(
    (await other.post("/api/invitations/accept", { token })).statusCode,
    410,
  );
  assert.equal(
    await db.membership.count({
      where: { propertyId: p.id, userId: other.userId },
    }),
    0,
  );
});
test("reenvio conserva link anterior até ativação; falha temporária não cria outro job", async () => {
  const { a, other, base } = await fixture();
  const r = await a.post(base + "/invitations", {
      ...intent(),
      email: other.email,
      role: "VIEWER",
    }),
    id = r.json().id;
  const first = await db.mailOutbox.findFirstOrThrow({
    where: { invitationId: id },
  });
  await db.mailOutbox.update({
    where: { id: first.id },
    data: { nextAttemptAt: new Date(0) },
  });
  await processOutbox(async () => {}, first.id);
  await db.invitation.update({
    where: { id },
    data: { createdAt: new Date(Date.now() - 61000) },
  });
  let i = await db.invitation.findUniqueOrThrow({ where: { id } });
  const resend = await a.post(`${base}/invitations/${id}`, {
    ...intent(),
    version: i.version,
    action: "RESEND",
  });
  assert.equal(resend.statusCode, 200, resend.body);
  const next = await db.mailOutbox.findFirstOrThrow({
      where: { invitationId: resend.json().id },
    }),
    encrypted = next.encrypted;
  await db.mailOutbox.update({
    where: { id: next.id },
    data: { nextAttemptAt: new Date(0) },
  });
  await processOutbox(async () => {
    throw new Error("simulated timeout");
  }, next.id);
  i = await db.invitation.findUniqueOrThrow({ where: { id } });
  assert.equal(i.status, "PENDING");
  const retry = await db.mailOutbox.findUniqueOrThrow({
    where: { id: next.id },
  });
  assert.equal(retry.status, "TEMP_FAILURE");
  assert.equal(retry.encrypted, encrypted);
  assert.equal(retry.attempts, 1);
  await db.mailOutbox.update({
    where: { id: next.id },
    data: { nextAttemptAt: new Date(0) },
  });
  await processOutbox(async () => {}, next.id);
  assert.equal(
    (await db.invitation.findUniqueOrThrow({ where: { id } })).status,
    "REVOKED",
  );
  assert.equal(
    (await db.invitation.findUniqueOrThrow({ where: { id: resend.json().id } }))
      .status,
    "PENDING",
  );
});
test("SMTP permanente e perda de chave encerram envio sem ativar acesso", async () => {
  const { a, other, base } = await fixture();
  const created = await a.post(base + "/invitations", {
      ...intent(),
      email: other.email,
      role: "VIEWER",
    }),
    id = created.json().id,
    job = await db.mailOutbox.findFirstOrThrow({ where: { invitationId: id } });
  await db.mailOutbox.update({
    where: { id: job.id },
    data: { nextAttemptAt: new Date(0) },
  });
  await processOutbox(async () => {
    throw Object.assign(new Error("simulated rejection"), {
      responseCode: 550,
    });
  }, job.id);
  assert.equal(
    (await db.invitation.findUniqueOrThrow({ where: { id } })).status,
    "REVOKED",
  );
  assert.equal(
    (await db.mailOutbox.findUniqueOrThrow({ where: { id: job.id } })).status,
    "FINAL_FAILURE",
  );
  const target = await user();
  const next = await a.post(base + "/invitations", {
      ...intent(),
      email: target.email,
      role: "VIEWER",
    }),
    second = await db.mailOutbox.findFirstOrThrow({
      where: { invitationId: next.json().id },
    });
  await db.mailOutbox.update({
    where: { id: second.id },
    data: { nextAttemptAt: new Date(0), encrypted: "corrupted.payload.value" },
  });
  await processOutbox(async () => {
    assert.fail("must not send corrupted content");
  }, second.id);
  assert.equal(
    (await db.invitation.findUniqueOrThrow({ where: { id: next.json().id } }))
      .status,
    "REVOKED",
  );
});
test("aceites simultâneos não duplicam autoria nem sobrescrevem papel pré-existente", async () => {
  const { a, other, p, base } = await fixture();
  const created = await a.post(base + "/invitations", {
      ...intent(),
      email: other.email,
      role: "OPERATOR",
    }),
    id = created.json().id,
    job = await db.mailOutbox.findFirstOrThrow({ where: { invitationId: id } }),
    token = decryptMail(job.encrypted).text.match(/#token=([a-f0-9]{64})/)![1];
  await db.mailOutbox.update({
    where: { id: job.id },
    data: { nextAttemptAt: new Date(0) },
  });
  await processOutbox(async () => {}, job.id);
  await db.membership.create({
    data: { userId: other.userId, propertyId: p.id, role: "VIEWER" },
  });
  const race = await Promise.all([
    other.post("/api/invitations/accept", { token }),
    other.post("/api/invitations/accept", { token }),
  ]);
  assert(race.every((r) => r.statusCode === 200));
  assert.equal(
    (
      await db.membership.findUniqueOrThrow({
        where: {
          userId_propertyId: { userId: other.userId, propertyId: p.id },
        },
      })
    ).role,
    "VIEWER",
  );
  assert.equal(
    await db.administrativeEvent.count({
      where: { propertyId: p.id, kind: "INVITATION_ACCEPTED" },
    }),
    1,
  );
  assert.equal(
    (
      await a.post(`${base}/members/${other.userId}`, {
        ...intent(),
        version: 1,
        role: "REMOVE",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await other.post("/api/invitations/accept", { token })).statusCode,
    410,
  );
});

test("duas remoções administrativas cruzadas conservam um ADMIN e não entram em deadlock", async () => {
  const { a, o, p, base } = await fixture();
  await db.membership.update({
    where: { userId_propertyId: { userId: o.userId, propertyId: p.id } },
    data: { role: "ADMIN" },
  });
  await a.reauth();
  await o.reauth();
  const race = await Promise.all([
    a.post(`${base}/members/${o.userId}`, {
      ...intent(),
      version: 1,
      role: "REMOVE",
    }),
    o.post(`${base}/members/${a.userId}`, {
      ...intent(),
      version: 1,
      role: "REMOVE",
    }),
  ]);
  assert.deepEqual(race.map((r) => r.statusCode).sort(), [200, 404]);
  assert.equal(
    await db.membership.count({ where: { propertyId: p.id, role: "ADMIN" } }),
    1,
  );
});
test("barreiras de propriedade forçam as duas ordens de gravação versus rebaixamento", async () => {
  const f = await fixture(),
    actor = {
      userId: f.o.userId,
      name: "Operador",
      sessionId: f.o.sessionId,
      propertyId: f.p.id,
      role: "OPERATOR",
      timezone: f.p.timezone,
    };
  let release!: () => void, ready!: () => void;
  const barrier = new Promise<void>((resolve) => {
      release = resolve;
    }),
    entered = new Promise<void>((resolve) => {
      ready = resolve;
    });
  const revoke = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Property" WHERE id=${f.p.id}::uuid FOR UPDATE`;
    await tx.membership.update({
      where: { userId_propertyId: { userId: f.o.userId, propertyId: f.p.id } },
      data: { role: "VIEWER" },
    });
    ready();
    await barrier;
  });
  await entered;
  const pending = locked(actor, async (tx) =>
    createProduct(tx, actor, {
      name: "Gravação bloqueada",
      category: "Outros",
      unit: "L",
      minimum: "0",
    }),
  );
  release();
  await revoke;
  await assert.rejects(
    pending,
    (e: unknown) => (e as { statusCode: number }).statusCode === 403,
  );
  assert.equal(await db.product.count({ where: { propertyId: f.p.id } }), 0);
  const g = await fixture(),
    second = {
      ...actor,
      userId: g.o.userId,
      sessionId: g.o.sessionId,
      propertyId: g.p.id,
    };
  let releaseWrite!: () => void, writeReady!: () => void;
  const wait = new Promise<void>((r) => {
      releaseWrite = r;
    }),
    started = new Promise<void>((r) => {
      writeReady = r;
    });
  const writing = locked(second, async (tx) => {
    const p = await createProduct(tx, second, {
      name: "Gravação já autorizada",
      category: "Outros",
      unit: "L",
      minimum: "0",
    });
    writeReady();
    await wait;
    return p;
  });
  await started;
  const demotion = g.a.post(`${g.base}/members/${g.o.userId}`, {
    ...intent(),
    version: 1,
    role: "VIEWER",
  });
  releaseWrite();
  await writing;
  assert.equal((await demotion).statusCode, 200);
  assert.equal(await db.product.count({ where: { propertyId: g.p.id } }), 1);
  await assert.rejects(locked(second, async () => true));
});
test("falha de auditoria desfaz categoria, revisão e intenção; retry posterior grava uma vez", async () => {
  const { a, p, base } = await fixture(),
    constraint = `phase7_fault_${randomUUID().replaceAll("-", "")}`,
    body = { ...intent(), name: "Categoria atômica" };
  assert.match(constraint, /^phase7_fault_[a-f0-9]{32}$/);
  await db.$executeRawUnsafe(
    `ALTER TABLE "AdministrativeEvent" ADD CONSTRAINT "${constraint}" CHECK ("propertyId" IS DISTINCT FROM '${p.id}'::uuid) NOT VALID`,
  );
  try {
    assert.equal((await a.post(base + "/categories", body)).statusCode, 503);
    assert.equal(
      await db.category.count({ where: { propertyId: p.id, name: body.name } }),
      0,
    );
    assert.equal(
      (await db.property.findUniqueOrThrow({ where: { id: p.id } }))
        .inventoryRevision,
      0,
    );
    assert.equal(
      await db.stockRequest.count({
        where: { propertyId: p.id, key: body.key },
      }),
      0,
    );
  } finally {
    await db.$executeRawUnsafe(
      `ALTER TABLE "AdministrativeEvent" DROP CONSTRAINT "${constraint}"`,
    );
  }
  assert.equal((await a.post(base + "/categories", body)).statusCode, 200);
  assert.equal((await a.post(base + "/categories", body)).statusCode, 200);
  assert.equal(
    await db.administrativeEvent.count({
      where: { propertyId: p.id, kind: "CATEGORY_CREATED" },
    }),
    1,
  );
});
test("duas trocas de e-mail disputam o mesmo destino sem trocar a identidade da perdedora", async () => {
  const a = await user(),
    b = await user(),
    target = `race-${randomUUID()}@example.test`,
    records: { id: string; token: string; client: Client }[] = [];
  for (const client of [a, b]) {
    const token = randomToken(),
      c = await db.emailChangeRequest.create({
        data: {
          userId: client.userId,
          oldEmail: client.email,
          newEmail: target,
          oldTokenHash: digest(randomToken()),
          newTokenHash: digest(token),
          oldConfirmedAt: new Date(),
          expiresAt: new Date(Date.now() + 1800000),
        },
      });
    records.push({ id: c.id, token, client });
  }
  const responses = await Promise.all(
    records.map((r) =>
      r.client.post("/api/account/email/confirm", { token: r.token }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409]);
  for (let i = 0; i < records.length; i++) {
    const u = await db.user.findUniqueOrThrow({
      where: { id: records[i].client.userId },
    });
    assert.equal(
      u.email,
      responses[i].statusCode === 200 ? target : records[i].client.email,
    );
  }
  await db.mailOutbox.deleteMany({
    where: { intent: { in: records.map((r) => `${r.id}:notice`) } },
  });
});
test("troca de e-mail e aceite concorrentes conservam a ordem de autorização e não travam", async () => {
  const { a, other, p } = await fixture(),
    token = randomToken(),
    next = randomToken();
  await db.invitation.create({
    data: {
      propertyId: p.id,
      email: other.email,
      role: "VIEWER",
      issuerId: a.userId,
      tokenHash: digest(token),
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const change = await db.emailChangeRequest.create({
    data: {
      userId: other.userId,
      oldEmail: other.email,
      newEmail: `changed-${randomUUID()}@example.test`,
      oldTokenHash: digest(randomToken()),
      newTokenHash: digest(next),
      oldConfirmedAt: new Date(),
      expiresAt: new Date(Date.now() + 1800000),
    },
  });
  const [accept, email] = await Promise.all([
    other.post("/api/invitations/accept", { token }),
    other.post("/api/account/email/confirm", { token: next }),
  ]);
  assert.equal(email.statusCode, 200, email.body);
  assert([200, 401].includes(accept.statusCode), accept.body);
  assert.equal(
    await db.membership.count({
      where: { userId: other.userId, propertyId: p.id },
    }),
    accept.statusCode === 200 ? 1 : 0,
  );
  await db.mailOutbox.deleteMany({ where: { intent: `${change.id}:notice` } });
});
test("reinício após quinta tentativa não deixa convite preso nem realiza sexto envio", async () => {
  const { a, other, base } = await fixture(),
    r = await a.post(base + "/invitations", {
      ...intent(),
      email: other.email,
      role: "VIEWER",
    }),
    job = await db.mailOutbox.findFirstOrThrow({
      where: { invitationId: r.json().id },
    });
  await db.mailOutbox.update({
    where: { id: job.id },
    data: { attempts: 5, leaseUntil: new Date(0), nextAttemptAt: new Date(0) },
  });
  await processOutbox(async () => {
    assert.fail("sixth send forbidden");
  }, job.id);
  const result = await db.mailOutbox.findUniqueOrThrow({
    where: { id: job.id },
  });
  assert.equal(result.status, "FINAL_FAILURE");
  assert.equal(result.attempts, 5);
  assert.equal(
    (await db.invitation.findUniqueOrThrow({ where: { id: r.json().id } }))
      .status,
    "REVOKED",
  );
});

test("perfil e solicitação de e-mail repetidos com mesma chave não duplicam efeito ou envios", async () => {
  const a = await user(),
    profile = { key: randomUUID(), name: "Perfil idempotente", version: 1 };
  assert.equal((await a.post("/api/account/profile", profile)).statusCode, 200);
  assert.equal((await a.post("/api/account/profile", profile)).statusCode, 200);
  assert.equal(
    (
      await a.post("/api/account/profile", {
        ...profile,
        name: "Outro conteúdo",
      })
    ).statusCode,
    409,
  );
  const b = {
    key: randomUUID(),
    email: `replay-${randomUUID()}@example.test`,
    currentPassword: password,
    version: 2,
  };
  assert.equal((await a.post("/api/account/email", b)).statusCode, 200);
  assert.equal((await a.post("/api/account/email", b)).statusCode, 200);
  const changes = await db.emailChangeRequest.findMany({
    where: { userId: a.userId },
  });
  assert.equal(changes.length, 1);
  assert.equal(
    await db.mailOutbox.count({
      where: { intent: { startsWith: changes[0].id } },
    }),
    2,
  );
  await db.mailOutbox.deleteMany({
    where: { intent: { startsWith: changes[0].id } },
  });
});
test("campos extras e ator forjado são recusados; paginação não omite registros", async () => {
  const { a, p, base } = await fixture();
  assert.equal(
    (
      await a.post(base + "/categories", {
        ...intent(),
        name: "Campo extra",
        actorId: randomUUID(),
      })
    ).statusCode,
    400,
  );
  for (let i = 0; i < 23; i++)
    await db.category.create({
      data: {
        propertyId: p.id,
        name: `Categoria ${i}`,
        nameKey: `categoria ${i}`,
      },
    });
  const first = (await a.get(base + "/categories?page=1")).json(),
    second = (await a.get(base + "/categories?page=2")).json();
  assert.equal(first.rows.length, 20);
  assert.equal(first.total, 33);
  assert.equal(second.rows.length, 13);
  assert.equal(
    new Set([...first.rows, ...second.rows].map((x) => x.id)).size,
    33,
  );
  for (let i = 0; i < 22; i++) await new Client(a.userId, a.email).init();
  const sessions = (await a.get("/api/account/sessions?page=1")).json(),
    more = (await a.get("/api/account/sessions?page=2")).json();
  assert.equal(sessions.rows.length, 20);
  assert.equal(more.rows.length, 3);
  assert.equal(sessions.total, 23);
  assert(sessions.rows.every((s: { tokenHash?: string }) => !s.tokenHash));
});

test("categoria inédita fica pendente na importação; associação preserva origem e rename invalida prévia", async () => {
  const { a, o, p, base } = await fixture();
  const csv =
    "Produto;Categoria;Unidade;Quantidade;Lote;Validade\nSemente revisada;Categoria do arquivo;kg;12;L1;N/A\n";
  const upload = await o.post(base + "/imports", {
    fileName: "categorias.csv",
    content: Buffer.from(csv).toString("base64"),
    mode: "POSITION",
  });
  assert.equal(upload.statusCode, 201, upload.body);
  const id = upload.json().id;
  const b = {
    sheet: 0,
    mapping: {
      product: 0,
      category: 1,
      unit: 2,
      quantity: 3,
      lot: 4,
      expiry: 5,
    },
    locale: "BR",
    positionDate: dayInZone(new Date(), p.timezone),
    edits: [],
  };
  const preview = await o.post(`${base}/imports/${id}/preview`, b);
  assert.equal(preview.statusCode, 200, preview.body);
  assert(
    preview.json().rows[0].errors.some((s: string) => s.includes("Categoria")),
  );
  const create = await a.post(base + "/categories", {
    ...intent(),
    name: "Categoria confirmada",
  });
  assert.equal(create.statusCode, 200);
  assert.equal(await db.product.count({ where: { propertyId: p.id } }), 0);
  const mapped = await o.post(`${base}/imports/${id}/preview`, {
    ...b,
    edits: [{ line: 2, values: { category: "Categoria confirmada" } }],
  });
  assert.equal(mapped.statusCode, 200, mapped.body);
  assert.deepEqual(mapped.json().rows[0].errors, []);
  assert.equal(mapped.json().rows[0].original[1], "Categoria do arquivo");
  const raw = await db.importBatch.findUniqueOrThrow({ where: { id } });
  assert.match(JSON.stringify(raw.raw), /Categoria do arquivo/);
  assert.equal(
    (
      await a.post(`${base}/categories/${create.json().id}`, {
        ...intent(),
        name: "Categoria renomeada",
        version: 1,
        archived: false,
      })
    ).statusCode,
    200,
  );
  const confirmed = await o.post(`${base}/imports/${id}/confirm`, {
    previewToken: mapped.json().previewToken,
    lines: [2],
    allowDuplicates: false,
    acknowledgeWarnings: true,
  });
  assert.equal(confirmed.statusCode, 409, confirmed.body);
  assert.equal(await db.product.count({ where: { propertyId: p.id } }), 0);
});

test("atividade pessoal não vaza para equipe; filtros e totais administrativos respeitam escopo", async () => {
  const { a, o, other, p, base } = await fixture();
  await a.post("/api/account/profile", {
    name: "Titular atualizado",
    version: 1,
  });
  const own = (await a.get("/api/account/audit")).json();
  assert.equal(own.total, 1);
  assert.equal(own.rows[0].kind, "PROFILE_CHANGED");
  assert.equal((await o.get("/api/account/audit")).json().total, 0);
  assert.equal((await a.get(base + "/audit")).json().total, 0);
  const filtered = (await a.get(base + "/members?q=Operador")).json();
  assert.equal(filtered.total, 1);
  assert.equal(filtered.rows[0].userId, o.userId);
  assert.equal((await other.get(base + "/members?q=Operador")).statusCode, 404);
  const cats = (await a.get(base + "/categories?page=1&q=Combust")).json();
  assert.equal(cats.total, 1);
  assert.equal(cats.rows[0].name, "Combustíveis");
  assert(cats.rows.every((r: { propertyId: string }) => r.propertyId === p.id));
});

test("validação de propriedade e duas edições concorrentes não alteram campos protegidos",async()=>{
  const {a,o,p,base}=await fixture();await db.membership.update({where:{userId_propertyId:{userId:o.userId,propertyId:p.id}},data:{role:"ADMIN"}});
  const body={...intent(),version:1,name:p.name,responsible:p.responsible,timezone:p.timezone,phone:""};
  for(const extra of [{name:"  "},{responsible:" "},{timezone:"Fuso/Inexistente"},{phone:"telefone inválido"},{startMethod:"IMPORT"}]){const response=await a.post(base+"/settings",{...body,...extra});assert.equal(response.statusCode,400,response.body);}
  const race=await Promise.all([a.post(base+"/settings",{...body,...intent(),name:"Primeira proposta"}),o.post(base+"/settings",{...body,...intent(),name:"Segunda proposta"})]);assert.deepEqual(race.map(r=>r.statusCode).sort(),[200,409]);const fresh=await db.property.findUniqueOrThrow({where:{id:p.id}});assert.equal(fresh.settingsVersion,2);assert.equal(fresh.startMethod,"MANUAL");assert.equal(fresh.inventoryRevision,0);assert.equal(await db.administrativeEvent.count({where:{propertyId:p.id}}),1);
});
test("limite de reautenticação segue a conta mesmo mudando IP e não bloqueia outro titular",async()=>{
  const a=await user(),b=await user();
  for(let n=0;n<6;n++){const r=await app.inject({method:"POST",url:"/api/account/reauthenticate",payload:{password:"senha errada"},remoteAddress:`192.0.2.${n+1}`,headers:{cookie:a.cookie,origin:settings.origin,"x-csrf-token":a.csrf}});assert.equal(r.statusCode,n<5?400:429);}
  const r=await app.inject({method:"POST",url:"/api/account/reauthenticate",payload:{password},remoteAddress:"192.0.2.1",headers:{cookie:b.cookie,origin:settings.origin,"x-csrf-token":b.csrf}});assert.equal(r.statusCode,200,r.body);
});
test("sem chave da outbox, convite e intenção sofrem rollback conjunto",async()=>{
  const {a,other,p,base}=await fixture(),saved=process.env.MAIL_ENCRYPTION_KEY,b={...intent(),email:other.email,role:"VIEWER"};
  try{delete process.env.MAIL_ENCRYPTION_KEY;assert.equal((await a.post(base+"/invitations",b)).statusCode,503);assert.equal(await db.invitation.count({where:{propertyId:p.id}}),0);assert.equal(await db.stockRequest.count({where:{propertyId:p.id,key:b.key}}),0);}
  finally{if(saved===undefined)delete process.env.MAIL_ENCRYPTION_KEY;else process.env.MAIL_ENCRYPTION_KEY=saved;}
  assert.equal((await a.post(base+"/invitations",b)).statusCode,200);
});
test("provas não se substituem, token de reset não vira convite e expiração exata bloqueia e-mail",async()=>{
  const a=await user(),old=randomToken(),fresh=randomToken(),request=await db.emailChangeRequest.create({data:{userId:a.userId,oldEmail:a.email,newEmail:`proof-${randomUUID()}@example.test`,oldTokenHash:digest(old),newTokenHash:digest(fresh),expiresAt:new Date(Date.now()+1800000)}});
  assert.equal((await a.post("/api/account/email/confirm",{token:old})).statusCode,200);assert.equal((await a.post("/api/account/email/confirm",{token:old})).json().loginRequired,false);assert.equal((await db.emailChangeRequest.findUniqueOrThrow({where:{id:request.id}})).newConfirmedAt,null);
  assert.equal((await a.post("/api/account/email/confirm",{token:old,side:"NEW"})).statusCode,400);
  await db.emailChangeRequest.update({where:{id:request.id},data:{expiresAt:new Date()}});assert.equal((await a.post("/api/account/email/confirm",{token:fresh})).statusCode,410);assert.equal((await db.user.findUniqueOrThrow({where:{id:a.userId}})).email,a.email);
  const reset=randomToken();await db.actionToken.create({data:{userId:a.userId,kind:"RESET_PASSWORD",tokenHash:digest(reset),expiresAt:new Date(Date.now()+60000)}});assert.equal((await a.post("/api/invitations/accept",{token:reset})).statusCode,404);assert.equal((await a.post("/api/invitations/preview",{token:digest(old)})).statusCode,404);
});

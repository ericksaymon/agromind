import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import argon2 from "argon2";
import { db } from "./db";
import {
  requireSession,
  failure,
  digest,
  randomToken,
  cookieOptions,
  sessionCookie,
} from "./security";
import {
  currentSession,
  userLocks,
  audit,
  version,
} from "./administration-service";
import { queueMail } from "./mail-outbox";
import { settings } from "./config";
import { createHmac } from "node:crypto";
const strict = { additionalProperties: false };
const secret = Type.String({ minLength: 1, maxLength: 128 });
const intentKey = Type.Optional(Type.String({ minLength: 8, maxLength: 100 }));
const nameBody = Type.Object(
  {
    key: intentKey,
    name: Type.String({ minLength: 2, maxLength: 120 }),
    version: Type.Integer({ minimum: 1 }),
  },
  strict,
);
const passwordBody = Type.Object(
  {
    currentPassword: secret,
    password: Type.String({ minLength: 8, maxLength: 128 }),
  },
  strict,
);
const emailBody = Type.Object(
  {
    key: intentKey,
    currentPassword: secret,
    email: Type.String({ format: "email", maxLength: 254 }),
    version: Type.Integer({ minimum: 1 }),
  },
  strict,
);
const tokenBody = Type.Object(
  { token: Type.String({ pattern: "^[a-f0-9]{64}$" }) },
  strict,
);
const pagination = Type.Object(
  { page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })) },
  strict,
);
const limited = {
  rateLimit: {
    max: 5,
    timeWindow: "15 minutes",
    keyGenerator: async (req: Parameters<typeof requireSession>[0]) =>
      (await requireSession(req)).userId,
  },
};
const validPassword = (s: string) =>
  s.length >= 8 && s.length <= 128 && /[a-zA-ZÀ-ÿ]/.test(s) && /[0-9]/.test(s);
async function personalIntent(
  tx: Parameters<typeof currentSession>[0],
  userId: string,
  key: string | undefined,
  purpose: string,
  body: unknown,
) {
  // HMAC avoids a fast password-guessing oracle if a database snapshot leaks.
  const hash = createHmac("sha256", settings.csrfSecret)
    .update(JSON.stringify({ purpose, body }))
    .digest("hex");
  const prior = key
    ? await tx.accountRequest.findUnique({
        where: { userId_key: { userId, key } },
      })
    : null;
  if (prior && prior.hash !== hash)
    failure(409, "Chave usada com outros dados.", "KEY_REUSED");
  return { hash, prior };
}
async function invalidate(
  tx: Parameters<typeof currentSession>[0],
  userId: string,
) {
  await tx.session.deleteMany({ where: { userId } });
  await tx.actionToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });
  await tx.emailChangeRequest.updateMany({
    where: { userId, status: "PENDING" },
    data: { status: "CANCELED" },
  });
}
export async function registerAccountRoutes(app: FastifyInstance) {
  app.get<{ Querystring: Static<typeof pagination> }>(
    "/api/account/audit",
    { schema: { querystring: pagination } },
    async (req) => {
      const s = await requireSession(req),
        where = { userId: s.userId, propertyId: null };
      const [rows, total] = await db.$transaction([
        db.administrativeEvent.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 20,
          skip: ((req.query.page || 1) - 1) * 20,
        }),
        db.administrativeEvent.count({ where }),
      ]);
      return { rows, total };
    },
  );
  app.get("/api/account", async (req) => {
    const s = await requireSession(req);
    const change = await db.emailChangeRequest.findFirst({
      where: {
        userId: s.userId,
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        newEmail: true,
        expiresAt: true,
        oldConfirmedAt: true,
        newConfirmedAt: true,
      },
    });
    const memberships = await db.membership.findMany({
      where: { userId: s.userId },
      select: {
        userId: true,
        propertyId: true,
        role: true,
        version: true,
        property: { select: { name: true } },
      },
      orderBy: { propertyId: "asc" },
    });
    return {
      memberships,
      id: s.userId,
      name: s.user.name,
      email: s.user.email,
      version: s.user.profileVersion,
      change,
      localMail: !settings.production,
    };
  });
  app.post<{ Body: Static<typeof nameBody> }>(
    "/api/account/profile",
    { schema: { body: nameBody } },
    async (req) => {
      const identity = await requireSession(req),
        name = req.body.name.trim();
      if (name.length < 2) failure(400, "Informe seu nome.");
      return db.$transaction(async (tx) => {
        await userLocks(tx, [identity.userId]);
        const s = await currentSession(tx, identity);
        const replay = await personalIntent(
          tx,
          s.userId,
          req.body.key,
          "PROFILE",
          req.body,
        );
        if (replay.prior) return replay.prior.result;
        version(s.user.profileVersion, req.body.version);
        if (s.user.name !== name) {
          await tx.user.update({
            where: { id: s.userId },
            data: { name, profileVersion: { increment: 1 } },
          });
          await audit(
            tx,
            s,
            null,
            "PROFILE_CHANGED",
            "Alteração pelo titular",
            { before: s.user.name, after: name },
          );
        }
        if (req.body.key)
          await tx.accountRequest.create({
            data: {
              userId: s.userId,
              key: req.body.key,
              hash: replay.hash,
              result: { ok: true },
            },
          });
        return { ok: true };
      });
    },
  );
  app.post<{ Body: { password: string } }>(
    "/api/account/reauthenticate",
    {
      schema: { body: Type.Object({ password: secret }, strict) },
      config: limited,
    },
    async (req) => {
      const identity = await requireSession(req);
      return db.$transaction(async (tx) => {
        await userLocks(tx, [identity.userId]);
        const s = await currentSession(tx, identity);
        if (!(await argon2.verify(s.user.passwordHash, req.body.password)))
          failure(400, "Senha atual incorreta.", "INVALID_CREDENTIALS");
        await tx.session.update({
          where: { id: s.id },
          data: { reauthenticatedAt: new Date() },
        });
        return { ok: true };
      });
    },
  );
  app.post<{ Body: Static<typeof passwordBody> }>(
    "/api/account/password",
    { schema: { body: passwordBody }, config: limited },
    async (req, reply) => {
      const identity = await requireSession(req);
      if (
        !validPassword(req.body.password) ||
        req.body.password === req.body.currentPassword
      )
        failure(
          400,
          "Use uma senha diferente, de 8 a 128 caracteres, com letras e números.",
        );
      const passwordHash = await argon2.hash(req.body.password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      await db.$transaction(async (tx) => {
        await userLocks(tx, [identity.userId]);
        const s = await currentSession(tx, identity);
        if (
          !(await argon2.verify(s.user.passwordHash, req.body.currentPassword))
        )
          failure(400, "Senha atual incorreta.", "INVALID_CREDENTIALS");
        await tx.user.update({
          where: { id: s.userId },
          data: { passwordHash, profileVersion: { increment: 1 } },
        });
        await invalidate(tx, s.userId);
        await audit(tx, s, null, "PASSWORD_CHANGED", "Alteração pelo titular", {
          sessionsRevoked: true,
        });
      });
      reply.clearCookie(sessionCookie, cookieOptions);
      return { ok: true, loginRequired: true };
    },
  );
  app.get<{ Querystring: Static<typeof pagination> }>(
    "/api/account/sessions",
    { schema: { querystring: pagination } },
    async (req) => {
      const s = await requireSession(req);
      const where = { userId: s.userId, expiresAt: { gt: new Date() } };
      const [rows, total] = await db.$transaction([
        db.session.findMany({
          where,
          select: { id: true, createdAt: true, expiresAt: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: ((req.query.page || 1) - 1) * 20,
          take: 20,
        }),
        db.session.count({ where }),
      ]);
      return {
        rows: rows.map((x) => ({ ...x, current: x.id === s.id })),
        total,
      };
    },
  );
  app.post<{ Body: { id: string } }>(
    "/api/account/sessions/revoke",
    {
      schema: {
        body: Type.Object(
          {
            id: Type.Union([
              Type.String({ format: "uuid" }),
              Type.Literal("others"),
            ]),
          },
          strict,
        ),
      },
    },
    async (req, reply) => {
      const identity = await requireSession(req);
      await db.$transaction(async (tx) => {
        await userLocks(tx, [identity.userId]);
        const s = await currentSession(tx, identity);
        if (req.body.id !== "others") {
          const target = await tx.session.findUnique({
            where: { id: req.body.id },
          });
          if (target && target.userId !== s.userId)
            failure(404, "Sessão não encontrada.");
        }
        const result = await tx.session.deleteMany({
          where: {
            userId: s.userId,
            id: req.body.id === "others" ? { not: s.id } : req.body.id,
          },
        });
        if (result.count)
          await audit(
            tx,
            s,
            null,
            "SESSIONS_REVOKED",
            "Encerramento pelo titular",
            { count: result.count },
          );
      });
      if (req.body.id === identity.id)
        reply.clearCookie(sessionCookie, cookieOptions);
      return { ok: true, loginRequired: req.body.id === identity.id };
    },
  );
  app.post<{ Body: Static<typeof emailBody> }>(
    "/api/account/email",
    { schema: { body: emailBody }, config: limited },
    async (req) => {
      const identity = await requireSession(req, true),
        email = req.body.email.trim().toLowerCase();
      return db.$transaction(async (tx) => {
        await userLocks(tx, [identity.userId]);
        const s = await currentSession(tx, identity, true);
        const replay = await personalIntent(
          tx,
          s.userId,
          req.body.key,
          "EMAIL",
          req.body,
        );
        if (replay.prior) return replay.prior.result;
        version(s.user.profileVersion, req.body.version);
        if (email === s.user.email) failure(400, "Informe um novo endereço.");
        if (
          !(await argon2.verify(s.user.passwordHash, req.body.currentPassword))
        )
          failure(400, "Senha atual incorreta.", "INVALID_CREDENTIALS");
        await tx.emailChangeRequest.updateMany({
          where: { userId: s.userId, status: "PENDING" },
          data: { status: "CANCELED" },
        });
        const old = randomToken(),
          fresh = randomToken();
        const change = await tx.emailChangeRequest.create({
          data: {
            userId: s.userId,
            oldEmail: s.user.email,
            newEmail: email,
            oldTokenHash: digest(old),
            newTokenHash: digest(fresh),
            expiresAt: new Date(Date.now() + 1800_000),
          },
        });
        for (const [side, to, token] of [
          ["old", s.user.email, old],
          ["new", email, fresh],
        ])
          await queueMail(tx, `${change.id}:${side}`, {
            to,
            subject: "Confirme a alteração de e-mail · AgroMind",
            text: `Confirme este endereço para alterar o e-mail da sua conta. São necessárias as duas confirmações, em até 30 minutos. Entre com a conta original.\n${settings.origin}/conta#emailToken=${token}\nSe não solicitou, cancele a alteração na sua conta.`,
          });
        await audit(
          tx,
          s,
          null,
          "EMAIL_CHANGE_STARTED",
          "Solicitação pelo titular",
          { requestId: change.id },
        );
        if (req.body.key)
          await tx.accountRequest.create({
            data: {
              userId: s.userId,
              key: req.body.key,
              hash: replay.hash,
              result: { ok: true },
            },
          });
        return { ok: true };
      });
    },
  );
  app.post(
    "/api/account/email/cancel",
    { schema: { body: Type.Object({}, strict) } },
    async (req) => {
      const identity = await requireSession(req);
      await db.$transaction(async (tx) => {
        await userLocks(tx, [identity.userId]);
        const s = await currentSession(tx, identity);
        const r = await tx.emailChangeRequest.updateMany({
          where: { userId: s.userId, status: "PENDING" },
          data: { status: "CANCELED" },
        });
        if (r.count)
          await audit(
            tx,
            s,
            null,
            "EMAIL_CHANGE_CANCELED",
            "Cancelamento pelo titular",
            {},
          );
      });
      return { ok: true };
    },
  );
  app.post<{ Body: Static<typeof tokenBody> }>(
    "/api/account/email/confirm",
    { schema: { body: tokenBody }, config: limited },
    async (req, reply) => {
      const identity = await requireSession(req),
        hash = digest(req.body.token);
      const result = await db.$transaction(async (tx) => {
        await userLocks(tx, [identity.userId]);
        const s = await currentSession(tx, identity);
        const change = await tx.emailChangeRequest.findFirst({
          where: {
            userId: s.userId,
            OR: [{ oldTokenHash: hash }, { newTokenHash: hash }],
          },
        });
        if (
          !change ||
          change.status !== "PENDING" ||
          change.expiresAt <= new Date() ||
          change.oldEmail !== s.user.email
        )
          failure(
            410,
            "Esta confirmação expirou ou foi cancelada.",
            "INVALID_TOKEN",
          );
        const updated = await tx.emailChangeRequest.update({
          where: { id: change.id },
          data:
            hash === change.oldTokenHash
              ? { oldConfirmedAt: new Date() }
              : { newConfirmedAt: new Date() },
        });
        if (!updated.oldConfirmedAt || !updated.newConfirmedAt)
          return { ok: true, loginRequired: false };
        const occupied = await tx.user.findUnique({
          where: { email: change.newEmail },
          select: { id: true },
        });
        if (occupied && occupied.id !== s.userId)
          failure(
            409,
            "Este endereço não está disponível. Inicie outra alteração.",
            "EMAIL_UNAVAILABLE",
          );
        // The unique index arbitrates two users confirming the same target concurrently.
        try {
          await tx.user.update({
            where: { id: s.userId },
            data: {
              email: change.newEmail,
              emailVerifiedAt: new Date(),
              profileVersion: { increment: 1 },
            },
          });
        } catch (e) {
          if ((e as { code?: string }).code === "P2002")
            failure(
              409,
              "Este endereço não está disponível. Inicie outra alteração.",
              "EMAIL_UNAVAILABLE",
            );
          throw e;
        }
        await tx.emailChangeRequest.update({
          where: { id: change.id },
          data: { status: "COMPLETED" },
        });
        await invalidate(tx, s.userId);
        await audit(
          tx,
          s,
          null,
          "EMAIL_CHANGED",
          "Duas confirmações pelo titular",
          { requestId: change.id },
        );
        await queueMail(tx, `${change.id}:notice`, {
          to: change.oldEmail,
          subject: "E-mail da conta alterado · AgroMind",
          text: "O e-mail da sua conta AgroMind foi alterado após as duas confirmações. As sessões anteriores foram encerradas.",
        });
        return { ok: true, loginRequired: true };
      });
      if (result.loginRequired) reply.clearCookie(sessionCookie, cookieOptions);
      return result;
    },
  );
}

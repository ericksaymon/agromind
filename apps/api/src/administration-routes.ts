import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { db } from "./db";
import {
  digest,
  failure,
  randomToken,
  requireMembership,
  requireSession,
} from "./security";
import {
  audit,
  currentSession,
  propertyAccess,
  recentAuthentication,
  userLocks,
  version,
  reason,
} from "./administration-service";
import { bump, keyOf, remember, replay, type Tx } from "./stock-service";
import { queueMail } from "./mail-outbox";
import { settings } from "./config";
import { Prisma } from "./generated/prisma/client";
const strict = { additionalProperties: false };
const uuid = Type.String({ format: "uuid" }),
  text = (max = 120) => Type.String({ maxLength: max });
const params = Type.Object({ id: uuid }),
  targetParams = Type.Object({ id: uuid, target: uuid });
const role = Type.Union([
  Type.Literal("ADMIN"),
  Type.Literal("OPERATOR"),
  Type.Literal("VIEWER"),
]);
const intent = {
  key: Type.String({ minLength: 8, maxLength: 100 }),
  reason: Type.String({ minLength: 3, maxLength: 500 }),
};
const paged = Type.Object(
  {
    page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
    q: Type.Optional(Type.String({ maxLength: 120 })),
  },
  strict,
);
const propertyBody = Type.Object(
  {
    ...intent,
    version: Type.Integer({ minimum: 1 }),
    name: text(),
    responsible: text(),
    phone: Type.Optional(text(30)),
    timezone: text(80),
    confirmTimezone: Type.Optional(Type.Boolean()),
  },
  strict,
);
const createBody = Type.Object(
  {
    ...intent,
    name: text(),
    responsible: text(),
    phone: Type.Optional(text(30)),
    timezone: text(80),
    startMethod: Type.Union([Type.Literal("IMPORT"), Type.Literal("MANUAL")]),
  },
  strict,
);
const categoryBody = Type.Object(
  { ...intent, name: Type.String({ minLength: 2, maxLength: 80 }) },
  strict,
);
const categoryUpdate = Type.Object(
  {
    ...intent,
    name: Type.String({ minLength: 2, maxLength: 80 }),
    version: Type.Integer({ minimum: 1 }),
    archived: Type.Boolean(),
  },
  strict,
);
const memberBody = Type.Object(
  {
    ...intent,
    version: Type.Integer({ minimum: 1 }),
    role: Type.Union([role, Type.Literal("REMOVE")]),
  },
  strict,
);
const inviteBody = Type.Object(
  { ...intent, email: Type.String({ format: "email", maxLength: 254 }), role },
  strict,
);
const invitationAction = Type.Object(
  {
    ...intent,
    version: Type.Integer({ minimum: 1 }),
    action: Type.Union([Type.Literal("RESEND"), Type.Literal("REVOKE")]),
  },
  strict,
);
const tokenBody = Type.Object(
  { token: Type.String({ pattern: "^[a-f0-9]{64}$" }) },
  strict,
);
function cleanProperty(b: {
  name: string;
  responsible: string;
  phone?: string;
  timezone: string;
}) {
  const name = b.name.trim(),
    responsible = b.responsible.trim(),
    phone = b.phone?.trim() || null;
  if (name.length < 2 || responsible.length < 2)
    failure(400, "Informe nome e responsável com pelo menos 2 caracteres.");
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: b.timezone }).format();
  } catch {
    failure(400, "Fuso horário inválido.");
  }
  if (phone && !/^[+()\d\s-]{8,30}$/.test(phone))
    failure(400, "Confira o telefone.");
  return { name, responsible, phone, timezone: b.timezone };
}
const pageArgs = (page = 1) => ({ skip: (page - 1) * 20, take: 20 });
async function mutation<T>(
  req: FastifyRequest,
  propertyId: string,
  key: string,
  payload: unknown,
  fn: (
    tx: Tx,
    access: Awaited<ReturnType<typeof propertyAccess>>,
  ) => Promise<T>,
  users: string[] = [],
  admin = true,
) {
  const identity = await requireSession(req, true);
  return db.$transaction(
    async (tx) => {
      await userLocks(tx, [identity.userId, ...users]);
      const access = await propertyAccess(tx, identity, propertyId, admin);
      const prior = await replay(tx, propertyId, key, payload);
      if (prior.result) return prior.result;
      const result = await fn(tx, access);
      await remember(tx, propertyId, key, prior.hash, result);
      return result;
    },
    { maxWait: 15000, timeout: 30000 },
  );
}
async function revokeInvitations(
  tx: Tx,
  propertyId: string,
  filter: { email?: string; issuerId?: string },
) {
  await tx.invitation.updateMany({
    where: { propertyId, ...filter, status: { in: ["QUEUED", "PENDING"] } },
    data: { status: "REVOKED", version: { increment: 1 } },
  });
}
async function issue(
  tx: Tx,
  s: { userId: string; user: { name: string } },
  p: { id: string; name: string },
  email: string,
  role: "ADMIN" | "OPERATOR" | "VIEWER",
  key: string,
  predecessorId?: string,
) {
  const since = new Date(Date.now() - 3600_000);
  const recent = await tx.invitation.findMany({
    where: { propertyId: p.id, createdAt: { gt: since } },
    select: { email: true, createdAt: true },
  });
  const target = recent.filter((x) => x.email === email);
  const now = Date.now(),
    waits = [0];
  if (recent.length >= 20)
    waits.push(
      Math.min(...recent.map((x) => x.createdAt.getTime())) + 3600_000 - now,
    );
  if (target.length >= 5)
    waits.push(
      Math.min(...target.map((x) => x.createdAt.getTime())) + 3600_000 - now,
    );
  if (target.length)
    waits.push(
      Math.max(...target.map((x) => x.createdAt.getTime())) + 60_000 - now,
    );
  const retryAfter = Math.ceil(Math.max(...waits) / 1000);
  if (retryAfter > 0)
    throw Object.assign(
      new Error(
        `Aguarde ${retryAfter < 60 ? `${retryAfter} segundos` : `${Math.ceil(retryAfter / 60)} minutos`} antes de solicitar outro envio. Os limites são por destinatário e propriedade.`,
      ),
      { statusCode: 429, code: "INVITE_COOLDOWN", retryAfter },
    );
  const raw = randomToken();
  const i = await tx.invitation.create({
    data: {
      propertyId: p.id,
      email,
      role,
      issuerId: s.userId,
      tokenHash: digest(raw),
      predecessorId,
    },
  });
  await queueMail(
    tx,
    `invite:${i.id}`,
    {
      to: email,
      subject: `Convite para ${p.name} · AgroMind`,
      text: `${s.user.name} convidou você para a propriedade ${p.name}, com acesso ${role}. O convite vale por sete dias após ativação.\n${settings.origin}/convite#token=${raw}\nEntre ou crie uma conta com este mesmo e-mail e confirme explicitamente o acesso. Se não conhece o convite, ignore esta mensagem.`,
    },
    i.id,
  );
  return { id: i.id, status: i.status };
}
export async function registerAdministrationRoutes(app: FastifyInstance) {
  app.post<{ Body: Static<typeof createBody> }>(
    "/api/account/properties",
    { schema: { body: createBody } },
    async (req) => {
      const identity = await requireSession(req, true),
        b = req.body,
        data = cleanProperty(b),
        why = reason(b.reason),
        hash = digest(JSON.stringify(b));
      return db.$transaction(async (tx) => {
        await userLocks(tx, [identity.userId]);
        const s = await currentSession(tx, identity, true);
        const prior = await tx.accountRequest.findUnique({
          where: { userId_key: { userId: s.userId, key: b.key } },
        });
        if (prior) {
          if (prior.hash !== hash)
            failure(409, "Chave usada em outra solicitação.", "KEY_REUSED");
          return prior.result;
        }
        const p = await tx.property.create({
          data: {
            ...data,
            startMethod: b.startMethod,
            memberships: { create: { userId: s.userId, role: "ADMIN" } },
          },
        });
        await tx.session.update({
          where: { id: s.id },
          data: { activePropertyId: p.id },
        });
        const result = { id: p.id, startMethod: p.startMethod };
        await tx.accountRequest.create({
          data: { userId: s.userId, key: b.key, hash, result },
        });
        await audit(
          tx,
          s,
          p.id,
          "PROPERTY_CREATED",
          why,
          { name: p.name },
          b.key,
        );
        return result;
      });
    },
  );
  app.post<{
    Params: Static<typeof params>;
    Body: Static<typeof propertyBody>;
  }>(
    "/api/properties/:id/settings",
    { schema: { params, body: propertyBody } },
    async (req) => {
      const b = req.body,
        data = cleanProperty(b),
        why = reason(b.reason);
      return mutation(
        req,
        req.params.id,
        b.key,
        b,
        async (tx, { session: s, property: p }) => {
          version(p.settingsVersion, b.version);
          const timezone = p.timezone !== data.timezone;
          if (timezone && !b.confirmTimezone)
            failure(
              400,
              "Confirme a troca de fuso e a necessidade de declarar a cobertura novamente.",
              "TIMEZONE_CONFIRMATION_REQUIRED",
            );
          const before = {
            name: p.name,
            responsible: p.responsible,
            phone: p.phone,
            timezone: p.timezone,
          };
          if (JSON.stringify(before) === JSON.stringify(data))
            return { ok: true };
          const coverage = timezone
            ? await tx.product.findMany({
                where: { propertyId: p.id },
                select: {
                  id: true,
                  coverageStart: true,
                  coverageEnd: true,
                  coverageOngoing: true,
                  coverageConfirmedBy: true,
                },
              })
            : undefined;
          await tx.property.update({
            where: { id: p.id },
            data: { ...data, settingsVersion: { increment: 1 } },
          });
          if (timezone) {
            await tx.product.updateMany({
              where: { propertyId: p.id },
              data: {
                coverageStart: null,
                coverageEnd: null,
                coverageOngoing: false,
                coverageConfirmedBy: null,
              },
            });
            await bump(tx, p.id);
          }
          await audit(
            tx,
            s,
            p.id,
            "PROPERTY_CHANGED",
            why,
            { before, after: data, previousCoverage: coverage },
            b.key,
          );
          return { ok: true };
        },
      );
    },
  );
  app.get<{ Params: Static<typeof params>; Querystring: Static<typeof paged> }>(
    "/api/properties/:id/categories",
    { schema: { params, querystring: paged } },
    async (req) => {
      await requireMembership(req, req.params.id);
      const where = {
        propertyId: req.params.id,
        ...(req.query.q
          ? {
              name: {
                contains: req.query.q.trim(),
                mode: "insensitive" as const,
              },
            }
          : {}),
      };
      if (req.query.page) {
        const [rows, total] = await db.$transaction([
          db.category.findMany({
            where,
            ...pageArgs(req.query.page),
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          }),
          db.category.count({ where }),
        ]);
        return { rows, total };
      }
      return db.category.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
    },
  );
  app.post<{
    Params: Static<typeof params>;
    Body: Static<typeof categoryBody>;
  }>(
    "/api/properties/:id/categories",
    { schema: { params, body: categoryBody } },
    async (req) => {
      const b = req.body,
        name = b.name.trim(),
        nameKey = keyOf(name),
        why = reason(b.reason);
      if (name.length < 2 || !nameKey)
        failure(400, "Nome de categoria inválido.");
      return mutation(
        req,
        req.params.id,
        b.key,
        b,
        async (tx, { session: s }) => {
          if (
            (await tx.category.count({
              where: { propertyId: req.params.id },
            })) >= 500
          )
            failure(
              422,
              "Limite técnico de 500 categorias por propriedade atingido.",
              "CATEGORY_LIMIT",
            );
          if (
            await tx.category.findUnique({
              where: {
                propertyId_nameKey: { propertyId: req.params.id, nameKey },
              },
            })
          )
            failure(
              409,
              "Esta categoria já existe, inclusive entre as arquivadas.",
              "CATEGORY_EXISTS",
            );
          const c = await tx.category.create({
            data: { propertyId: req.params.id, name, nameKey },
          });
          await bump(tx, req.params.id);
          await audit(
            tx,
            s,
            req.params.id,
            "CATEGORY_CREATED",
            why,
            { id: c.id, name },
            b.key,
          );
          return { id: c.id };
        },
      );
    },
  );
  app.post<{
    Params: Static<typeof targetParams>;
    Body: Static<typeof categoryUpdate>;
  }>(
    "/api/properties/:id/categories/:target",
    { schema: { params: targetParams, body: categoryUpdate } },
    async (req) => {
      const b = req.body,
        name = b.name.trim(),
        nameKey = keyOf(name),
        why = reason(b.reason);
      if (name.length < 2 || !nameKey)
        failure(400, "Nome de categoria inválido.");
      return mutation(
        req,
        req.params.id,
        b.key,
        { ...b, target: req.params.target },
        async (tx, { session: s }) => {
          const c = await tx.category.findFirst({
            where: { id: req.params.target, propertyId: req.params.id },
          });
          if (!c) failure(404, "Categoria não encontrada.");
          version(c.version, b.version);
          if (c.name === name && c.archived === b.archived) return { ok: true };
          if (
            await tx.category.findFirst({
              where: { propertyId: c.propertyId, nameKey, id: { not: c.id } },
            })
          )
            failure(409, "Nome equivalente já cadastrado.", "CATEGORY_EXISTS");
          await tx.category.update({
            where: { id: c.id },
            data: {
              name,
              nameKey,
              archived: b.archived,
              version: { increment: 1 },
            },
          });
          await tx.product.updateMany({
            where: { propertyId: c.propertyId, categoryId: c.id },
            data: { category: name },
          });
          await bump(tx, c.propertyId);
          await audit(
            tx,
            s,
            c.propertyId,
            "CATEGORY_CHANGED",
            why,
            {
              before: { id: c.id, name: c.name, archived: c.archived },
              after: { name, archived: b.archived },
            },
            b.key,
          );
          return { ok: true };
        },
      );
    },
  );
  app.get<{ Params: Static<typeof params>; Querystring: Static<typeof paged> }>(
    "/api/properties/:id/members",
    { schema: { params, querystring: paged } },
    async (req) => {
      await requireMembership(req, req.params.id, true);
      const match = req.query.q?.trim(),
        where = {
          propertyId: req.params.id,
          ...(match
            ? {
                OR: [
                  {
                    user: {
                      name: { contains: match, mode: "insensitive" as const },
                    },
                  },
                  {
                    user: {
                      email: { contains: match, mode: "insensitive" as const },
                    },
                  },
                ],
              }
            : {}),
        };
      const [rows, total] = await db.$transaction([
        db.membership.findMany({
          where,
          ...pageArgs(req.query.page),
          orderBy: [{ user: { createdAt: "asc" } }, { userId: "asc" }],
          select: {
            userId: true,
            role: true,
            version: true,
            user: { select: { name: true, email: true } },
          },
        }),
        db.membership.count({ where }),
      ]);
      return { rows, total };
    },
  );
  app.post<{
    Params: Static<typeof targetParams>;
    Body: Static<typeof memberBody>;
  }>(
    "/api/properties/:id/members/:target",
    { schema: { params: targetParams, body: memberBody } },
    async (req) => {
      const identity = await requireSession(req, true),
        b = req.body,
        why = reason(b.reason),
        self = req.params.target === identity.userId;
      return mutation(
        req,
        req.params.id,
        b.key,
        { ...b, target: req.params.target },
        async (tx, { session: s, membership: actor }) => {
          const m = await tx.membership.findUnique({
            where: {
              userId_propertyId: {
                userId: req.params.target,
                propertyId: req.params.id,
              },
            },
            include: { user: true },
          });
          if (!m) failure(404, "Membro não encontrado.");
          if (!(self && b.role === "REMOVE") && actor.role !== "ADMIN")
            failure(403, "Sem permissão.", "FORBIDDEN");
          version(m.version, b.version);
          if (m.role === b.role) return { ok: true };
          if (m.role === "ADMIN" || b.role === "ADMIN") recentAuthentication(s);
          if (
            m.role === "ADMIN" &&
            (await tx.membership.count({
              where: { propertyId: m.propertyId, role: "ADMIN" },
            })) <= 1
          )
            failure(
              409,
              "Mantenha pelo menos um administrador efetivo.",
              "LAST_ADMIN",
            );
          if (b.role === "REMOVE") {
            await tx.membership.delete({
              where: {
                userId_propertyId: {
                  userId: m.userId,
                  propertyId: m.propertyId,
                },
              },
            });
            const next = await tx.membership.findFirst({
              where: { userId: m.userId },
              orderBy: [
                { property: { createdAt: "asc" } },
                { propertyId: "asc" },
              ],
            });
            await tx.session.updateMany({
              where: { userId: m.userId, activePropertyId: m.propertyId },
              data: { activePropertyId: next?.propertyId ?? null },
            });
            await tx.importBatch.updateMany({
              where: {
                propertyId: m.propertyId,
                userId: m.userId,
                status: "DRAFT",
              },
              data: { status: "CANCELLED", raw: [], preview: Prisma.DbNull },
            });
            await revokeInvitations(tx, m.propertyId, { email: m.user.email });
          } else
            await tx.membership.update({
              where: {
                userId_propertyId: {
                  userId: m.userId,
                  propertyId: m.propertyId,
                },
              },
              data: { role: b.role, version: { increment: 1 } },
            });
          if (m.role === "ADMIN")
            await revokeInvitations(tx, m.propertyId, { issuerId: m.userId });
          if (b.role === "VIEWER" || b.role === "REMOVE") {
            const alerts = await tx.alertOccurrence.findMany({
              where: {
                propertyId: m.propertyId,
                assigneeId: m.userId,
                closedAt: null,
              },
              select: { id: true },
            });
            await tx.alertOccurrence.updateMany({
              where: {
                propertyId: m.propertyId,
                assigneeId: m.userId,
                closedAt: null,
              },
              data: {
                assigneeId: null,
                assigneeName: null,
                actionVersion: { increment: 1 },
              },
            });
            for (const a of alerts)
              await tx.analysisEvent.create({
                data: {
                  propertyId: m.propertyId,
                  alertId: a.id,
                  kind: "ASSIGNEE_REMOVED",
                  actorId: s.userId,
                  actorName: s.user.name,
                  details: { reason: why, userId: m.userId },
                },
              });
          }
          await audit(
            tx,
            s,
            m.propertyId,
            "MEMBERSHIP_CHANGED",
            why,
            { userId: m.userId, before: m.role, after: b.role },
            b.key,
          );
          return { ok: true };
        },
        [req.params.target],
        false,
      );
    },
  );
  app.get<{ Params: Static<typeof params>; Querystring: Static<typeof paged> }>(
    "/api/properties/:id/audit",
    { schema: { params, querystring: paged } },
    async (req) => {
      await requireMembership(req, req.params.id, true);
      const match = req.query.q?.trim(),
        where = {
          propertyId: req.params.id,
          ...(match
            ? {
                OR: [
                  {
                    actorName: {
                      contains: match,
                      mode: "insensitive" as const,
                    },
                  },
                  { reason: { contains: match, mode: "insensitive" as const } },
                  { kind: { contains: match, mode: "insensitive" as const } },
                ],
              }
            : {}),
        };
      const [rows, total] = await db.$transaction([
        db.administrativeEvent.findMany({
          where,
          ...pageArgs(req.query.page),
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
        db.administrativeEvent.count({ where }),
      ]);
      return { rows, total };
    },
  );
  app.get<{ Params: Static<typeof params>; Querystring: Static<typeof paged> }>(
    "/api/properties/:id/invitations",
    { schema: { params, querystring: paged } },
    async (req) => {
      await requireMembership(req, req.params.id, true);
      const where = {
        propertyId: req.params.id,
        ...(req.query.q
          ? {
              email: {
                contains: req.query.q.trim(),
                mode: "insensitive" as const,
              },
            }
          : {}),
      };
      const [rows, total] = await db.$transaction([
        db.invitation.findMany({
          where,
          ...pageArgs(req.query.page),
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
            version: true,
            expiresAt: true,
            createdAt: true,
          },
        }),
        db.invitation.count({ where }),
      ]);
      const delivery = await db.mailOutbox.findMany({
        where: { invitationId: { in: rows.map((x) => x.id) } },
        select: {
          invitationId: true,
          status: true,
          attempts: true,
          nextAttemptAt: true,
        },
      });
      return {
        rows: rows.map((x) => ({
          ...x,
          status:
            x.status === "PENDING" && x.expiresAt && x.expiresAt <= new Date()
              ? "EXPIRED"
              : x.status,
          delivery: delivery.find((d) => d.invitationId === x.id),
        })),
        total,
      };
    },
  );
  app.post<{ Params: Static<typeof params>; Body: Static<typeof inviteBody> }>(
    "/api/properties/:id/invitations",
    { schema: { params, body: inviteBody } },
    async (req) => {
      const b = req.body,
        email = b.email.trim().toLowerCase(),
        why = reason(b.reason);
      return mutation(
        req,
        req.params.id,
        b.key,
        b,
        async (tx, { session: s, property: p }) => {
          if (b.role === "ADMIN") recentAuthentication(s);
          if (
            await tx.membership.findFirst({
              where: { propertyId: p.id, user: { email } },
            })
          )
            failure(
              409,
              "Este endereço já pertence à equipe. Use a alteração de papel.",
              "ALREADY_MEMBER",
            );
          await tx.invitation.updateMany({
            where: {
              propertyId: p.id,
              email,
              status: "PENDING",
              expiresAt: { lte: new Date() },
            },
            data: { status: "EXPIRED", version: { increment: 1 } },
          });
          if (
            await tx.invitation.findFirst({
              where: {
                propertyId: p.id,
                email,
                status: { in: ["QUEUED", "PENDING"] },
              },
            })
          )
            failure(
              409,
              "Já existe um convite em andamento. Use reenviar ou revogar.",
              "INVITE_EXISTS",
            );
          const result = await issue(tx, s, p, email, b.role, b.key);
          await audit(
            tx,
            s,
            p.id,
            "INVITATION_CREATED",
            why,
            { id: result.id, role: b.role },
            b.key,
          );
          return result;
        },
      );
    },
  );
  app.post<{
    Params: Static<typeof targetParams>;
    Body: Static<typeof invitationAction>;
  }>(
    "/api/properties/:id/invitations/:target",
    { schema: { params: targetParams, body: invitationAction } },
    async (req) => {
      const b = req.body,
        why = reason(b.reason);
      return mutation(
        req,
        req.params.id,
        b.key,
        { ...b, target: req.params.target },
        async (tx, { session: s, property: p }) => {
          const i = await tx.invitation.findFirst({
            where: { id: req.params.target, propertyId: p.id },
          });
          if (!i) failure(404, "Convite não encontrado.");
          version(i.version, b.version);
          if (i.status === "ACCEPTED")
            failure(409, "Convite já aceito. Gerencie o membro na equipe.");
          if (b.action === "REVOKE") {
            await tx.invitation.updateMany({
              where: {
                propertyId: p.id,
                OR: [{ id: i.id }, { predecessorId: i.id }],
                status: { in: ["PENDING", "QUEUED"] },
              },
              data: { status: "REVOKED", version: { increment: 1 } },
            });
            await audit(
              tx,
              s,
              p.id,
              "INVITATION_REVOKED",
              why,
              { id: i.id },
              b.key,
            );
            return { ok: true };
          }
          if (i.role === "ADMIN") recentAuthentication(s);
          const active = await tx.invitation.findFirst({
            where: { propertyId: p.id, email: i.email, status: "PENDING" },
          });
          if (active && active.id !== i.id)
            failure(
              409,
              "Há um convite mais recente. Reenvie a partir dele.",
              "INVITE_SUPERSEDED",
            );
          if (
            await tx.invitation.findFirst({
              where: { propertyId: p.id, email: i.email, status: "QUEUED" },
            })
          )
            failure(
              409,
              "Já existe um envio na fila. Revogue-o antes de solicitar outro.",
            );
          const result = await issue(
            tx,
            s,
            p,
            i.email,
            i.role,
            b.key,
            i.status === "PENDING" ? i.id : undefined,
          );
          await audit(
            tx,
            s,
            p.id,
            "INVITATION_RESENT",
            why,
            { id: i.id, successor: result.id },
            b.key,
          );
          return result;
        },
      );
    },
  );
  const tokenRate = { rateLimit: { max: 30, timeWindow: "15 minutes" } };
  app.post<{ Body: Static<typeof tokenBody> }>(
    "/api/invitations/preview",
    { schema: { body: tokenBody }, config: tokenRate },
    async (req) => {
      const i = await db.invitation.findUnique({
        where: { tokenHash: digest(req.body.token) },
      });
      if (!i) failure(404, "Convite não encontrado.", "INVALID_TOKEN");
      if (i.status === "QUEUED")
        failure(
          409,
          "O envio está sendo processado. Aguarde e tente novamente.",
          "INVITE_PROCESSING",
        );
      if (i.status !== "PENDING" || !i.expiresAt || i.expiresAt <= new Date())
        failure(
          410,
          "Convite expirado, revogado ou já utilizado.",
          "INVITE_UNAVAILABLE",
        );
      const p = await db.property.findUnique({
        where: { id: i.propertyId },
        select: { name: true },
      });
      return { propertyName: p?.name, role: i.role, expiresAt: i.expiresAt };
    },
  );
  app.post<{ Body: Static<typeof tokenBody> }>(
    "/api/invitations/accept",
    { schema: { body: tokenBody }, config: tokenRate },
    async (req) => {
      const identity = await requireSession(req, true),
        initial = await db.invitation.findUnique({
          where: { tokenHash: digest(req.body.token) },
        });
      if (!initial) failure(404, "Convite não encontrado.");
      return db.$transaction(async (tx) => {
        await userLocks(tx, [identity.userId]);
        await tx.$queryRaw`SELECT id FROM "Property" WHERE id=${initial.propertyId}::uuid FOR UPDATE`;
        const s = await currentSession(tx, identity, true),
          i = await tx.invitation.findUniqueOrThrow({
            where: { id: initial.id },
          });
        if (s.user.email !== i.email)
          failure(
            403,
            "Entre com o e-mail que recebeu este convite.",
            "INVITE_EMAIL_MISMATCH",
          );
        const membership = await tx.membership.findUnique({
          where: {
            userId_propertyId: { userId: s.userId, propertyId: i.propertyId },
          },
        });
        if (i.status === "ACCEPTED" && i.acceptedBy === s.userId && membership)
          return { ok: true, propertyId: i.propertyId, alreadyAccepted: true };
        if (i.status === "QUEUED")
          failure(409, "Convite ainda em processamento.", "INVITE_PROCESSING");
        if (i.status !== "PENDING" || !i.expiresAt || i.expiresAt <= new Date())
          failure(410, "Convite expirado ou indisponível.");
        const issuer = await tx.membership.findUnique({
          where: {
            userId_propertyId: { userId: i.issuerId, propertyId: i.propertyId },
          },
        });
        if (issuer?.role !== "ADMIN")
          failure(410, "Peça um novo convite a um administrador.");
        if (!membership)
          await tx.membership.create({
            data: { userId: s.userId, propertyId: i.propertyId, role: i.role },
          });
        await tx.invitation.update({
          where: { id: i.id },
          data: {
            status: "ACCEPTED",
            acceptedBy: s.userId,
            version: { increment: 1 },
          },
        });
        await tx.session.update({
          where: { id: s.id },
          data: { activePropertyId: i.propertyId },
        });
        await audit(
          tx,
          s,
          i.propertyId,
          "INVITATION_ACCEPTED",
          "Aceite explícito pelo destinatário",
          { id: i.id, role: membership?.role ?? i.role },
        );
        return { ok: true, propertyId: i.propertyId };
      });
    },
  );
}

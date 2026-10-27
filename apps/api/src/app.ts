import { registerAccountRoutes } from "./account-routes";
import { registerAdministrationRoutes } from "./administration-routes";
import { userLocks, currentSession, propertyAccess, audit } from "./administration-service";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { Type, type Static } from "@sinclair/typebox";
import argon2 from "argon2";
import { db } from "./db";
import { settings } from "./config";
import { cookieOptions, createSession, csrfToken, digest, failure, requireMembership, requireSession, sessionCookie, validateMutation } from "./security";
import { sendAction } from "./mail";
import type { AuthSession } from "../../../packages/contracts/src/index";
import type { FastifyRequest } from "fastify";
import { registerStockRoutes } from "./stock-routes";
import { registerAnalysisRoutes } from "./analysis-routes";
import { registerIntelligenceRoutes } from "./intelligence-routes";
import { registerWhatsappRoutes, WHATSAPP_WEBHOOK_PATH } from "./whatsapp-routes";

const email = Type.String({ format: "email", maxLength: 254 });
const password = Type.String({ minLength: 8, maxLength: 128 });
const emailBody = Type.Object({ email }, { additionalProperties: false });
const registerBody = Type.Object({ name: Type.String({ minLength: 2, maxLength: 120 }), email, password, terms: Type.Literal(true) }, { additionalProperties: false });
const loginBody = Type.Object({ email, password: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false });
const tokenBody = Type.Object({ token: Type.String({ pattern: "^[a-f0-9]{64}$" }) }, { additionalProperties: false });
const resetBody = Type.Object({ token: Type.String({ pattern: "^[a-f0-9]{64}$" }), password }, { additionalProperties: false });
const propertyBody = Type.Object({ name: Type.String({ minLength: 2, maxLength: 120 }), responsible: Type.String({ minLength: 2, maxLength: 120 }), timezone: Type.String({ minLength: 3, maxLength: 80 }), phone: Type.Optional(Type.String({ maxLength: 30 })), startMethod: Type.Union([Type.Literal("IMPORT"), Type.Literal("MANUAL")]) }, { additionalProperties: false });
const propertyParams = Type.Object({ id: Type.String({ format: "uuid" }) });
const restricted = { rateLimit: { max: 10, timeWindow: "15 minutes", keyGenerator: (request: FastifyRequest) => request.ip } };
const normalize = (value: string) => value.trim().toLowerCase();
const validPassword = (value: string) => value.length >= 8 && value.length <= 128 && /[a-zA-ZÀ-ÿ]/.test(value) && /[0-9]/.test(value);

export async function buildApp({ test = false } = {}) {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } }, logger: test ? false : { level: "info", redact: ["req.headers.cookie", "req.headers.authorization", "req.headers.x-csrf-token", "res.headers.set-cookie"] }, bodyLimit: 16384, trustProxy: process.env.API_TRUST_PROXY || false });
  await app.register(cookie);
  await app.register(rateLimit, { max: 180, timeWindow: "1 minute", keyGenerator: async request => {
    const token = request.cookies[sessionCookie];
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const session = await db.session.findUnique({ where: { tokenHash: digest(token) }, select: { id: true, expiresAt: true } });
      if (session && session.expiresAt > new Date()) return `session:${session.id}`;
    }
    return request.ip;
  } });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff").header("Referrer-Policy", "no-referrer");
    // This exact machine-to-machine endpoint authenticates the original bytes with Meta's HMAC.
    if (!(request.method === "POST" && request.routeOptions.url === WHATSAPP_WEBHOOK_PATH)) validateMutation(request);
  });
  app.addHook("preValidation", async request => {
    const body = request.body as { email?: unknown } | null;
    if (body && typeof body.email === "string") body.email = body.email.trim().toLowerCase();
  });
  app.setErrorHandler((error, _request, reply) => {
    if ((error as { validation?: unknown }).validation) return reply.code(400).send({ message: "Confira os campos informados.", code: "VALIDATION_ERROR" });
    const known = error as { statusCode?: number; code?: string; message?: string; retryAfter?: number };
    if (known.code === "P2002") return reply.code(409).send({ message: "Não foi possível criar a conta. Se já possui cadastro, entre ou recupere sua senha." });
    if (known.statusCode === 429) { if(known.retryAfter)reply.header("Retry-After",known.retryAfter); return reply.code(429).send({ message: known.code==="INVITE_COOLDOWN"?known.message:"Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.", code: known.code==="INVITE_COOLDOWN"?known.code:"RATE_LIMITED", ...(known.retryAfter?{retryAfter:known.retryAfter}:{}) }); }
    if (known.statusCode && known.statusCode < 500) return reply.code(known.statusCode).send({ message: known.message, code: known.code });
    app.log.error({ code: known.code || "INTERNAL_ERROR" }, "Falha ao processar solicitação");
    return reply.code(503).send({ message: "Não foi possível concluir agora. Tente novamente em instantes.", code: "SERVICE_UNAVAILABLE" });
  });
  // Mesma verificação custosa mesmo quando o e-mail não está cadastrado.
  const dummyHash = await argon2.hash("dummy-password-not-a-user", { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  app.get("/api/health", async () => { await db.$queryRaw`SELECT 1`; return { ok: true }; });
  app.get("/api/auth/csrf", async (request, reply) => ({ token: csrfToken(request, reply) }));

  app.post<{ Body: Static<typeof registerBody> }>("/api/auth/register", { schema: { body: registerBody }, config: restricted }, async (request, reply) => {
    const { password: value } = request.body;
    const name = request.body.name.trim();
    if (name.length < 2 || !validPassword(value)) failure(400, "Use seu nome e uma senha de 8 a 128 caracteres com letras e números.");
    const passwordHash = await argon2.hash(value, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const user = await db.user.create({ data: { name, email: normalize(request.body.email), passwordHash, termsVersion: settings.production ? "2026-10-23-piloto" : "2026-10-22-local" } });
    await createSession(user.id, request, reply, user.passwordHash);
    try { await sendAction(user, "VERIFY_EMAIL"); } catch { return reply.code(201).send({ ok: true, mailPending: true }); }
    return reply.code(201).send({ ok: true });
  });
  app.post<{ Body: Static<typeof loginBody> }>("/api/auth/login", { schema: { body: loginBody }, config: restricted }, async (request, reply) => {
    const user = await db.user.findUnique({ where: { email: normalize(request.body.email) } });
    const valid = await argon2.verify(user?.passwordHash || dummyHash, request.body.password);
    if (!user || !valid) failure(401, "E-mail ou senha incorretos.", "INVALID_CREDENTIALS");
    await createSession(user.id, request, reply, user.passwordHash);
    return { ok: true };
  });
  app.post("/api/auth/logout", async (request, reply) => {
    const raw = request.cookies[sessionCookie];
    if (raw) await db.session.deleteMany({ where: { tokenHash: digest(raw) } });
    reply.clearCookie(sessionCookie, cookieOptions);
    return { ok: true };
  });
  app.get("/api/auth/me", async (request): Promise<AuthSession> => {
    const session = await requireSession(request);
    const links = await db.membership.findMany({ where: { userId: session.userId }, include: { property: true }, orderBy: { property: { createdAt: "asc" } } });
    const properties = links.map(({ property, role }) => ({ id: property.id, name: property.name, responsible: property.responsible, timezone: property.timezone, phone: property.phone, startMethod: property.startMethod, role }));
    return { user: { id: session.user.id, name: session.user.name, email: session.user.email, emailVerified: !!session.user.emailVerifiedAt }, property: properties.find(p => p.id === session.activePropertyId) || properties[0] || null, properties };
  });
  app.post<{ Body: Static<typeof emailBody> }>("/api/auth/forgot-password", { schema: { body: emailBody }, config: restricted }, async request => {
    const user = await db.user.findUnique({ where: { email: normalize(request.body.email) } });
    if (user) { try { await sendAction(user, "RESET_PASSWORD"); } catch { app.log.warn({ code: "MAIL_UNAVAILABLE" }, "Solicitação de recuperação não entregue"); } }
    return { ok: true, message: "Se houver uma conta com esse e-mail, você receberá um link para redefinir sua senha." };
  });
  app.post<{ Body: Static<typeof resetBody> }>("/api/auth/reset-password", { schema: { body: resetBody }, config: restricted }, async (request, reply) => {
    if (!validPassword(request.body.password)) failure(400, "Use de 8 a 128 caracteres com letras e números.");
    const token = await db.actionToken.findUnique({ where: { tokenHash: digest(request.body.token) } });
    if (!token || token.kind !== "RESET_PASSWORD" || token.usedAt || token.expiresAt <= new Date()) failure(400, "Este link expirou ou já foi utilizado. Solicite outro.", "INVALID_TOKEN");
    const passwordHash = await argon2.hash(request.body.password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await db.$transaction(async tx => {
      await userLocks(tx, [token.userId]);
      const used = await tx.actionToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (used.count !== 1) failure(400, "Este link expirou ou já foi utilizado.", "INVALID_TOKEN");
      await tx.user.update({ where: { id: token.userId }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: token.userId } });
      await tx.emailChangeRequest.updateMany({ where: { userId: token.userId, status: "PENDING" }, data: { status: "CANCELED" } });
      await tx.actionToken.updateMany({ where: { userId: token.userId, kind: "RESET_PASSWORD", usedAt: null }, data: { usedAt: new Date() } });
    });
    reply.clearCookie(sessionCookie, cookieOptions);
    return { ok: true };
  });
  app.post("/api/auth/resend-verification", { config: { rateLimit: { max: 3, timeWindow: "5 minutes" } } }, async request => {
    const session = await requireSession(request);
    if (!session.user.emailVerifiedAt) { try { await sendAction(session.user, "VERIFY_EMAIL"); } catch { failure(503, "O e-mail não pôde ser enviado agora. Tente novamente em instantes."); } }
    return { ok: true };
  });
  app.post<{ Body: Static<typeof tokenBody> }>("/api/auth/verify-email", { schema: { body: tokenBody }, config: restricted }, async request => {
    const token = await db.actionToken.findUnique({ where: { tokenHash: digest(request.body.token) } });
    if (!token || token.kind !== "VERIFY_EMAIL" || token.usedAt || token.expiresAt <= new Date()) failure(400, "Este link expirou ou já foi utilizado. Solicite outro.", "INVALID_TOKEN");
    await db.$transaction(async tx => {
      const used = await tx.actionToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (used.count !== 1) failure(400, "Este link já foi utilizado.", "INVALID_TOKEN");
      await tx.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date() } });
    });
    return { ok: true };
  });

  app.post<{ Body: Static<typeof propertyBody> }>("/api/properties", { schema: { body: propertyBody } }, async (request, reply) => {
    const session = await requireSession(request, true);
    const data = cleanProperty(request.body);
    const property = await db.$transaction(async tx => {
      // Serializa duas tentativas simultâneas de concluir a configuração inicial.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${session.userId}::uuid FOR UPDATE`;
      const freshSession = await currentSession(tx, session, true);
      if (await tx.membership.count({ where: { userId: session.userId } })) failure(409, "Sua propriedade já está configurada.", "ALREADY_CONFIGURED");
      const created = await tx.property.create({ data: { ...data, memberships: { create: { userId: session.userId, role: "ADMIN" } } } });
      await tx.session.update({ where: { id: session.id }, data: { activePropertyId: created.id } });
      await audit(tx, freshSession, created.id, "PROPERTY_CREATED", "Configuração inicial pelo titular", { name: created.name });
      return created;
    });
    return reply.code(201).send({ id: property.id, startMethod: property.startMethod });
  });
  app.get<{ Params: Static<typeof propertyParams> }>("/api/properties/:id", { schema: { params: propertyParams } }, async request => {
    const { membership } = await requireMembership(request, request.params.id);
    return { ...membership.property, role: membership.role };
  });
  app.post<{ Body: { propertyId: string } }>("/api/auth/active-property", { schema: { body: Type.Object({ propertyId: Type.String({ format: "uuid" }) }, { additionalProperties: false }) } }, async request => {
    const identity = await requireSession(request, true);
    await db.$transaction(async tx => {
      await userLocks(tx, [identity.userId]);
      const { session } = await propertyAccess(tx, identity, request.body.propertyId, false);
      await tx.session.update({ where: { id: session.id }, data: { activePropertyId: request.body.propertyId } });
    });
    return { ok: true };
  });
  await registerAccountRoutes(app);
  await registerAdministrationRoutes(app);
  await registerStockRoutes(app);
  await registerAnalysisRoutes(app);
  await registerIntelligenceRoutes(app);
  await registerWhatsappRoutes(app);
  return app;
}

function cleanProperty(body: Static<typeof propertyBody>) {
  const name = body.name.trim(), responsible = body.responsible.trim();
  if (name.length < 2 || responsible.length < 2) failure(400, "Informe o nome da propriedade e do responsável.");
  try { new Intl.DateTimeFormat("pt-BR", { timeZone: body.timezone }).format(); } catch { failure(400, "Selecione um fuso horário válido."); }
  const phone = body.phone?.trim() || null;
  if (phone && !/^[+()\d\s-]{8,30}$/.test(phone)) failure(400, "Confira o telefone informado.");
  return { name, responsible, timezone: body.timezone, phone, startMethod: body.startMethod };
}

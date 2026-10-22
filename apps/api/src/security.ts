import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { settings } from "./config";
import { db } from "./db";

export const sessionCookie = settings.production ? "__Host-agromind_session" : "agromind_session";
export const csrfCookie = settings.production ? "__Host-agromind_csrf" : "agromind_csrf";
export const cookieOptions = { path: "/", httpOnly: true, sameSite: "lax" as const, secure: settings.production };
export const digest = (token: string) => createHash("sha256").update(token).digest("hex");
export const randomToken = () => randomBytes(32).toString("hex");
export function failure(statusCode: number, message: string, code = "REQUEST_FAILED"): never {
  throw Object.assign(new Error(message), { statusCode, code });
}
function equal(a: string, b: string) { const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
export function validCsrf(value: string | undefined) {
  if (!value || value.length > 256) return false;
  const [nonce, date, signature] = value.split(".");
  if (!nonce || !date || !signature || !/^\d+$/.test(date)) return false;
  const age = Date.now() - Number(date);
  const expected = createHmac("sha256", settings.csrfSecret).update(`${nonce}.${date}`).digest("hex");
  return age >= 0 && age < 3_600_000 && equal(signature, expected);
}
export function csrfToken(request: FastifyRequest, reply: FastifyReply) {
  const existing = request.cookies[csrfCookie];
  if (validCsrf(existing)) return existing!;
  const value = `${randomToken()}.${Date.now()}`;
  const token = `${value}.${createHmac("sha256", settings.csrfSecret).update(value).digest("hex")}`;
  reply.setCookie(csrfCookie, token, { ...cookieOptions, maxAge: 3600 });
  return token;
}
export function validateMutation(request: FastifyRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  if (request.headers.origin !== settings.origin) failure(403, "Origem da solicitação não permitida.", "INVALID_ORIGIN");
  const token = request.headers["x-csrf-token"];
  const cookie = request.cookies[csrfCookie];
  if (typeof token !== "string" || !cookie || !validCsrf(cookie) || !equal(token, cookie)) {
    failure(403, "Sua confirmação de segurança expirou. Tente novamente.", "INVALID_CSRF");
  }
}
export async function requireSession(request: FastifyRequest, verified = false) {
  const raw = request.cookies[sessionCookie];
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) failure(401, "Entre para continuar.", "UNAUTHENTICATED");
  const session = await db.session.findUnique({ where: { tokenHash: digest(raw) }, include: { user: true } });
  if (!session || session.expiresAt <= new Date()) failure(401, "Sua sessão expirou. Entre novamente.", "UNAUTHENTICATED");
  if (verified && !session.user.emailVerifiedAt) failure(403, "Confirme seu e-mail para continuar.", "EMAIL_NOT_VERIFIED");
  return session;
}
export async function createSession(userId: string, request: FastifyRequest, reply: FastifyReply, expectedHash?: string) {
  const raw = randomToken();
  const membership = await db.membership.findFirst({ where: { userId }, orderBy: { property: { createdAt: "asc" } } });
  const previous = request.cookies[sessionCookie];
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId}::uuid FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (expectedHash && user.passwordHash !== expectedHash) failure(401, "Sua senha mudou. Entre novamente.", "INVALID_CREDENTIALS");
    if (previous) await tx.session.deleteMany({ where: { tokenHash: digest(previous) } });
    await tx.session.create({ data: { userId, tokenHash: digest(raw), activePropertyId: membership?.propertyId, expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
  });
  reply.setCookie(sessionCookie, raw, { ...cookieOptions, maxAge: 7 * 86400 });
}
export async function requireMembership(request: FastifyRequest, propertyId: string, admin = false) {
  const session = await requireSession(request, true);
  const membership = await db.membership.findUnique({ where: { userId_propertyId: { userId: session.userId, propertyId } }, include: { property: true } });
  if (!membership) failure(404, "Propriedade não encontrada.", "NOT_FOUND");
  if (admin && membership.role !== "ADMIN") failure(403, "Você não tem permissão para alterar esta propriedade.", "FORBIDDEN");
  return { session, membership };
}

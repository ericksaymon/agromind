import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app";
import { db } from "../src/db";
import { digest, randomToken, sessionCookie } from "../src/security";
import { settings } from "../src/config";

let app: Awaited<ReturnType<typeof buildApp>>;
const userIds: string[] = [], propertyIds: string[] = [];
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const password = "Teste123";
class Browser {
  cookies = new Map<string, string>();
  csrf = "";
  async request(method: "GET" | "POST" | "PATCH", url: string, payload?: unknown, overrides: Record<string, string> = {}) {
    const result = await app.inject({ method, url, payload: payload as Record<string, unknown>, headers: {
      cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      ...(method !== "GET" ? { origin: settings.origin, "x-csrf-token": this.csrf } : {}), ...overrides,
    } });
    for (const cookie of result.cookies) { if (cookie.value) this.cookies.set(cookie.name, cookie.value); else this.cookies.delete(cookie.name); }
    return result;
  }
  async init() { this.csrf = (await this.request("GET", "/api/auth/csrf")).json().token; return this; }
}
async function mailToken(email: string, kind: "confirmar-email" | "redefinir-senha") {
  for (let attempt = 0; attempt < 25; attempt++) {
    const list = await fetch("http://127.0.0.1:18025/api/v1/messages?limit=100").then(r => r.json()) as { messages: { ID: string; To: { Address: string }[] }[] };
    for (const item of list.messages.filter(m => m.To.some(t => t.Address === email))) {
      const message = await fetch(`http://127.0.0.1:18025/api/v1/message/${item.ID}`).then(r => r.json()) as { Text: string };
      const match = message.Text.match(new RegExp(`${kind}#token=([a-f0-9]{64})`));
      if (match) return match[1];
    }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error("E-mail de teste não encontrado na caixa local.");
}
before(async () => { app = await buildApp({ test: true }); });
after(async () => {
  if (propertyIds.length) await db.property.deleteMany({ where: { id: { in: propertyIds } } });
  if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
  await app.close(); await db.$disconnect();
});

test("acesso, confirmação, propriedade, isolamento, papéis, recuperação e revogação", async () => {
  const alice = await new Browser().init();
  const bob = await new Browser().init();
  const aliceEmail = `phase2-alice-${suffix}@example.test`, bobEmail = `phase2-bob-${suffix}@example.test`;
  assert.equal((await alice.request("POST", "/api/auth/register", { name: "Ana Teste", email: aliceEmail, password: "Teste12", terms: true })).statusCode, 400);
  const register = await alice.request("POST", "/api/auth/register", { name: "Ana Teste", email: aliceEmail, password, terms: true });
  assert.equal(register.statusCode, 201);
  assert(register.cookies.some(c => c.name === sessionCookie && c.httpOnly && c.sameSite === "Lax"));
  const beforeVerify = await alice.request("GET", "/api/auth/me");
  assert.equal(beforeVerify.statusCode, 200); assert.equal(beforeVerify.json().user.emailVerified, false);
  assert.equal(beforeVerify.json().user.passwordHash, undefined);
  const aliceId = beforeVerify.json().user.id; userIds.push(aliceId);
  const property = { name: "Sítio da Ana", responsible: "Ana Teste", timezone: "America/Porto_Velho", startMethod: "IMPORT" };
  assert.equal((await alice.request("POST", "/api/properties", property)).statusCode, 403);
  const verify = await mailToken(aliceEmail, "confirmar-email");
  assert.equal((await alice.request("POST", "/api/auth/verify-email", { token: verify })).statusCode, 200);
  assert.equal((await alice.request("POST", "/api/auth/verify-email", { token: verify })).statusCode, 400);
  const storedToken = await db.actionToken.findUnique({ where: { tokenHash: digest(verify) } });
  assert(storedToken?.usedAt); assert.notEqual(storedToken?.tokenHash, verify);
  assert.equal((await alice.request("POST", "/api/properties", property, { "x-csrf-token": "invalid" })).statusCode, 403);
  assert.equal((await alice.request("POST", "/api/properties", property, { origin: "http://other.example" })).statusCode, 403);
  const created = await alice.request("POST", "/api/properties", property);
  assert.equal(created.statusCode, 201); const propertyId = created.json().id; propertyIds.push(propertyId);
  assert.equal((await alice.request("GET", "/api/auth/me")).json().property.name, property.name);
  assert.equal((await alice.request("POST", "/api/properties", property)).statusCode, 409);
  const reloaded = new Browser(); reloaded.cookies = new Map(alice.cookies); await reloaded.init();
  assert.equal((await reloaded.request("GET", "/api/auth/me")).json().property.id, propertyId);
  assert.equal((await bob.request("POST", "/api/auth/register", { name: "Bruno Teste", email: bobEmail, password, terms: true })).statusCode, 201);
  const bobId = (await bob.request("GET", "/api/auth/me")).json().user.id; userIds.push(bobId);
  assert.equal((await bob.request("POST", "/api/auth/verify-email", { token: await mailToken(bobEmail, "confirmar-email") })).statusCode, 200);
  const bobProperty = await bob.request("POST", "/api/properties", { ...property, name: "Fazenda do Bruno", startMethod: "MANUAL" });
  assert.equal(bobProperty.statusCode, 201); propertyIds.push(bobProperty.json().id);
  assert.equal((await bob.request("GET", `/api/properties/${propertyId}`)).statusCode, 404);
  assert.equal((await bob.request("PATCH", `/api/properties/${propertyId}`, { ...property, name: "Tentativa indevida" })).statusCode, 404);
  assert.equal((await bob.request("POST", "/api/auth/active-property", { propertyId })).statusCode, 404);
  assert.equal((await db.property.findUniqueOrThrow({ where: { id: propertyId } })).name, property.name);
  // Um usuário com papel de consulta lê sua propriedade, mas não a altera.
  await db.membership.create({ data: { userId: bobId, propertyId, role: "VIEWER" } });
  assert.equal((await bob.request("GET", `/api/properties/${propertyId}`)).statusCode, 200);
  assert.equal((await bob.request("POST", `/api/properties/${propertyId}/settings`, { ...property, startMethod: undefined, key: randomToken(), reason: "Teste de permissão", version: 1 })).statusCode, 403);
  assert.equal((await alice.request("POST", `/api/properties/${propertyId}/settings`, { ...property, startMethod: undefined, name: "Sítio atualizado", key: randomToken(), reason: "Teste de edição", version: 1 })).statusCode, 200);
  assert.equal((await reloaded.request("GET", "/api/auth/me")).json().property.name, "Sítio atualizado");
  const outsider = await new Browser().init();
  assert.equal((await outsider.request("GET", `/api/properties/${propertyId}`)).statusCode, 401);
  const invalid = await outsider.request("POST", "/api/auth/login", { email: aliceEmail, password: "incorrect" });
  assert.equal(invalid.statusCode, 401);
  const forgotten = await outsider.request("POST", "/api/auth/forgot-password", { email: aliceEmail });
  const absent = await outsider.request("POST", "/api/auth/forgot-password", { email: `absent-${suffix}@example.test` });
  assert.equal(forgotten.statusCode, 200); assert.deepEqual(forgotten.json(), absent.json());
  const reset = await mailToken(aliceEmail, "redefinir-senha");
  const expired = randomToken();
  await db.actionToken.create({ data: { userId: aliceId, kind: "RESET_PASSWORD", tokenHash: digest(expired), expiresAt: new Date(Date.now() - 60000) } });
  assert.equal((await outsider.request("POST", "/api/auth/reset-password", { token: expired, password })).statusCode, 400);
  const newPassword = "Outra123";
  const race = await Promise.all([outsider.request("POST", "/api/auth/reset-password", { token: reset, password: newPassword }), outsider.request("POST", "/api/auth/reset-password", { token: reset, password: newPassword })]);
  assert.deepEqual(race.map(r => r.statusCode).sort(), [200, 400]);
  assert.equal((await alice.request("GET", "/api/auth/me")).statusCode, 401);
  assert.equal((await reloaded.request("GET", "/api/auth/me")).statusCode, 401);
  assert.equal((await outsider.request("POST", "/api/auth/login", { email: aliceEmail, password })).statusCode, 401);
  assert.equal((await outsider.request("POST", "/api/auth/login", { email: aliceEmail, password: newPassword })).statusCode, 200);
  const oldSession = new Browser(); oldSession.cookies = new Map(outsider.cookies);
  assert.equal((await outsider.request("POST", "/api/auth/logout", {})).statusCode, 200);
  assert.equal((await oldSession.request("GET", "/api/auth/me")).statusCode, 401);
  const unverifiedStoredPassword = await db.user.findUniqueOrThrow({ where: { id: aliceId } });
  assert.match(unverifiedStoredPassword.passwordHash, /^\$argon2id\$/);
});

test("limite de tentativas de login é aplicado", async () => {
  const browser = await new Browser().init();
  let limited = false;
  for (let i = 0; i < 12; i++) {
    const response = await browser.request("POST", "/api/auth/login", { email: `limit-${suffix}@example.test`, password: "wrong" });
    if (response.statusCode === 429) { limited = true; break; }
  }
  assert(limited);
});

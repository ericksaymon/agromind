import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { buildApp } from "../src/app";
import { db } from "../src/db";

const account = `test-${Date.now()}`, phone = "test-phone", secret = randomBytes(32).toString("hex"), token = randomBytes(32).toString("hex"), key = randomBytes(32);
const variables = { WHATSAPP_APP_SECRET: secret, WHATSAPP_VERIFY_TOKEN: token, WHATSAPP_PHONE_NUMBER_ID: phone, WHATSAPP_ACCOUNT_IDS: account, WHATSAPP_INBOX_KEY: key.toString("hex") };
const previous = Object.fromEntries(Object.keys(variables).map(k => [k, process.env[k]]));
let app: Awaited<ReturnType<typeof buildApp>>;
const payload = (id: string, extra: Record<string, unknown> = {}) => JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: account, changes: [{ field: "messages", value: { metadata: { phone_number_id: phone }, messages: [{ id, from: "5569999990000", type: "text", text: { body: "Olá, diesel!" } }], ...extra } }] }] });
const send = (raw: string, signature = createHmac("sha256", secret).update(raw).digest("hex")) => app.inject({ method: "POST", url: "/api/webhooks/whatsapp", headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${signature}` }, payload: raw });
before(async () => { Object.assign(process.env, variables); app = await buildApp({ test: true }); });
after(async () => {
  await app?.close();
  await db.whatsappInboxEvent.deleteMany({ where: { accountId: account } });
  await db.$disconnect();
  for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

test("WhatsApp: challenge exato e token incorreto recusado", async () => {
  const good = await app.inject(`/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=123456`);
  assert.equal(good.statusCode, 200); assert.equal(good.body, "123456");
  assert.match(good.headers["content-type"]!, /text\/plain/);
  const bad = await app.inject("/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=123456");
  assert.equal(bad.statusCode, 403);
});

test("WhatsApp: assinatura usa bytes originais; evento cifrado e repetição concorrente idempotente", async () => {
  const raw = payload("unique-message");
  const changed = await send(`${raw} `, createHmac("sha256", secret).update(raw).digest("hex"));
  assert.equal(changed.statusCode, 401);
  const responses = await Promise.all([send(raw), send(raw), send(raw)]);
  assert.deepEqual(responses.map(r => r.statusCode), [200, 200, 200]);
  const rows = await db.whatsappInboxEvent.findMany({ where: { accountId: account, kind: "message" } });
  assert.equal(rows.length, 1); assert.equal(rows[0].processedAt, null);
  assert.ok(!rows[0].encrypted.includes("diesel"));
  const [iv, tag, ciphertext] = rows[0].encrypted.split(".").map(v => Buffer.from(v, "base64"));
  const cipher = createDecipheriv("aes-256-gcm", key, iv); cipher.setAuthTag(tag);
  const item = JSON.parse(Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString("utf8"));
  assert.equal(item.text.body, "Olá, diesel!");
});

test("WhatsApp: falta de assinatura e JSON inválido não gravam; canal desconfigurado falha fechado", async () => {
  assert.equal((await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: JSON.parse(payload("missing")) })).statusCode, 401);
  assert.equal((await send("{")).statusCode, 400);
  delete process.env.WHATSAPP_APP_SECRET;
  try { assert.equal((await send(payload("disabled"))).statusCode, 503); }
  finally { process.env.WHATSAPP_APP_SECRET = secret; }
});

test("WhatsApp: conta e número diferentes não entram na caixa; estados de entrega são distintos", async () => {
  assert.equal((await send(payload("wrong-account").replace(account, "other-account"))).statusCode, 200);
  assert.equal((await send(payload("wrong-phone").replace(phone, "other-phone"))).statusCode, 200);
  const statuses = ["sent", "delivered"].map(status => ({ id: "outgoing-1", status, timestamp: "1793000000", recipient_id: "5569999990000" }));
  const raw = payload("same-message", { messages: [], statuses });
  await send(raw); await send(raw);
  assert.equal(await db.whatsappInboxEvent.count({ where: { accountId: account, kind: "status" } }), 2);
  assert.equal(await db.whatsappInboxEvent.count({ where: { accountId: account, kind: "message" } }), 1);
});

test("WhatsApp: falha de persistência retorna erro para nova tentativa e limite de corpo é aplicado", async () => {
  // Force a real storage failure; the event must not be acknowledged on rollback.
  const originalAccount = process.env.WHATSAPP_ACCOUNT_IDS;
  process.env.WHATSAPP_ACCOUNT_IDS = "x".repeat(41);
  try { assert.equal((await send(payload("rollback").replace(account, "x".repeat(41)))).statusCode, 503); }
  finally { process.env.WHATSAPP_ACCOUNT_IDS = originalAccount; }
  assert.equal((await send(" ".repeat(1_048_577))).statusCode, 413);
});

test("WhatsApp: proteção de origem/CSRF das rotas de navegador permanece ativa", async () => {
  const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "test@example.com", password: "Test12345" } });
  assert.equal(response.statusCode, 403); assert.equal(response.json().code, "INVALID_ORIGIN");
});

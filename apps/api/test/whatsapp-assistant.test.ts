import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { db } from "../src/db";
import { digest, sessionCookie } from "../src/security";
import { settings } from "../src/config";
import { encryptWhatsapp, decryptWhatsapp } from "../src/whatsapp-crypto";
import { processWhatsappEvent, sendWhatsappReply, metaSend } from "../src/whatsapp-service";
import { routeWhatsappQuestion } from "../src/whatsapp-intent";
import { AudioError, transcribeWhatsappAudio } from "../src/whatsapp-audio";
import { processAnalysis } from "../src/analysis-service";
const prefix = `assistant-${Date.now()}`, users: string[] = [], properties: string[] = [], events: string[] = [];
const envNames = ["WHATSAPP_INBOX_KEY", "WHATSAPP_PUBLIC_NUMBER", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_GRAPH_VERSION", "WHATSAPP_ALLOW_LOCAL_PAIRING", "OPENROUTER_API_KEY"];
const previous = envNames.map(k => process.env[k]);
let app: Awaited<ReturnType<typeof buildApp>>;
before(async () => { delete process.env.OPENROUTER_API_KEY; process.env.WHATSAPP_ALLOW_LOCAL_PAIRING = "true"; process.env.WHATSAPP_INBOX_KEY = randomBytes(32).toString("hex"); process.env.WHATSAPP_PUBLIC_NUMBER = "556900000000"; app = await buildApp({ test: true }); });
after(async () => {
  await app.close();
  await db.whatsappPairAttempt.deleteMany({ where: { eventKey: { in: events } } });
  await db.whatsappReply.deleteMany({ where: { eventKey: { in: events } } });
  await db.whatsappInboxEvent.deleteMany({ where: { eventKey: { in: events } } });
  await db.property.deleteMany({ where: { id: { in: properties } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
  envNames.forEach((k, i) => { if (previous[i] === undefined) delete process.env[k]; else process.env[k] = previous[i]; });
});
async function fixture(role: "ADMIN" | "VIEWER" = "VIEWER") {
  const user = await db.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Pessoa sintética", passwordHash: "test", emailVerifiedAt: new Date() } }); users.push(user.id);
  const p = await db.property.create({ data: { name: "Propriedade sintética", responsible: "Teste", timezone: "America/Cuiaba", startMethod: "MANUAL", memberships: { create: { userId: user.id, role } } } }); properties.push(p.id);
  const token = randomBytes(32).toString("hex");
  const session = await db.session.create({ data: { userId: user.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 86400000) } });
  const csrf = await app.inject({ url: "/api/auth/csrf", headers: { cookie: `${sessionCookie}=${token}` } });
  const headers = { cookie: `${sessionCookie}=${token}; ${csrf.cookies.map(c => `${c.name}=${c.value}`).join("; ")}`, origin: settings.origin, "x-csrf-token": csrf.json().token };
  const post = (url: string, body: object = {}) => app.inject({ method: "POST", url, headers, payload: body });
  const code = async () => { const r = await post("/api/account/whatsapp/code", { propertyId: p.id }); assert.equal(r.statusCode, 200, r.body); return r.json().message as string; };
  return { user, p, session, headers, post, code, phone: `5569${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}` };
}
async function message(phone: string, body: string, extra: object = {}, kind = "message") {
  const eventKey = digest(randomUUID()); events.push(eventKey);
  await db.whatsappInboxEvent.create({ data: { eventKey, accountId: prefix, phoneNumberId: "synthetic", kind, encrypted: encryptWhatsapp({ id: eventKey, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body }, ...extra }) } });
  return eventKey;
}
async function receive(phone: string, text: string, extra: object = {}) {
  const key = await message(phone, text, extra);
  assert.equal(await processWhatsappEvent(key), true);
  return db.whatsappReply.findUnique({ where: { eventKey: key } });
}
const response = (r: { encrypted: string } | null) => { assert.ok(r); return decryptWhatsapp<{ to: string; text: string }>(r.encrypted).text; };

test("assistente: código com hash, geração invalida anterior, escopo e CSRF", async () => {
  const a = await fixture(), b = await fixture();
  const first = await a.code(), second = await a.code();
  assert.notEqual(first, second);
  const old = await db.whatsappPairCode.findUniqueOrThrow({ where: { hash: digest(first.split(" ")[1].toLowerCase()) } }); assert.ok(old.usedAt);
  assert.equal((await a.post("/api/account/whatsapp/code", { propertyId: b.p.id })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: "/api/account/whatsapp/code", payload: { propertyId: a.p.id } })).statusCode, 403);
  assert.equal((await app.inject({ url: "/api/account/whatsapp" })).statusCode, 401);
});
test("assistente: VIEWER vincula com código único, concorrência e replay não duplicam vínculo/resposta", async () => {
  const a = await fixture(); const code = await a.code(), key = await message(a.phone, code);
  await Promise.all([processWhatsappEvent(key), processWhatsappEvent(key)]);
  assert.equal(await db.whatsappConnection.count({ where: { userId: a.user.id } }), 1);
  assert.equal(await db.whatsappReply.count({ where: { eventKey: key } }), 1);
  assert.match(response(await db.whatsappReply.findUnique({ where: { eventKey: key } })), /conectado/);
  assert.match(response(await receive(a.phone, code)), /inválido|indisponível/);
  const state = await app.inject({ url: "/api/account/whatsapp", headers: a.headers }); assert.equal(state.json().connection.lastDigits, a.phone.slice(-4)); assert.equal(JSON.stringify(state.json()).includes(a.phone), false);
});
test("assistente: código expirado, sessão revogada e telefone de outro titular são recusados", async () => {
  const a = await fixture(), b = await fixture();
  const code = await a.code();
  await db.whatsappPairCode.update({ where: { hash: digest(code.split(" ")[1].toLowerCase()) }, data: { expiresAt: new Date(0) } });
  assert.match(response(await receive(a.phone, code)), /inválido|indisponível/);
  await receive(a.phone, await a.code());
  assert.match(response(await receive(a.phone, await b.code())), /inválido|indisponível/);
  const valid = await b.code(); await db.session.delete({ where: { id: b.session.id } });
  assert.match(response(await receive(b.phone, valid)), /inválido|expirado|Não encontrei/);
  assert.equal(await db.whatsappConnection.count({ where: { userId: b.user.id } }), 0);
});
test("assistente: saldo real, isolamento, validade, ambiguidade e ausência de histórico", async () => {
  const a = await fixture(); await receive(a.phone, await a.code());
  const category = await db.category.findFirstOrThrow({ where: { propertyId: a.p.id, nameKey: "combustiveis" } });
  const p = await db.product.create({ data: { propertyId: a.p.id, name: "Diesel S10", nameKey: "diesel s10", category: category.name, categoryId: category.id, unit: "L", minimum: "60", minimumKnown: true, lots: { create: [{ code: "A", balance: "40.5", expiryStatus: "NA" }, { code: "B", balance: "5", expiryStatus: "DATED", expiresOn: new Date("2000-01-01") }] } } });
  assert.match(response(await receive(a.phone, "Quanto diesel temos?")), /Saldo físico: 45.5 L/);
  assert.match(response(await receive(a.phone, "O que está perto de vencer?")), /vencido/);
  await processAnalysis(a.p.id);
  assert.match(response(await receive(a.phone, "O que está abaixo do mínimo?")), /Diesel S10/);
  assert.match(response(await receive(a.phone, "Qual a autonomia do diesel?")), /histórico suficiente/);
  await db.product.create({ data: { propertyId: a.p.id, name: "Diesel S500", nameKey: "diesel s500", category: category.name, categoryId: category.id, unit: "L" } });
  assert.match(response(await receive(a.phone, "Quanto diesel temos?")), /mais de um/);
  assert.match(response(await receive(a.phone, "Retire 20 litros de diesel")), /nenhuma alteração/);
  assert.equal(await db.stockMovement.count({ where: { productId: p.id } }), 0);
  assert.match(response(await receive(a.phone, "consulta", { type: "image" })), /por texto ou por mensagem de voz/);
  const stranger = await receive("556900000099", "Quanto diesel temos?"); assert.ok(!response(stranger).includes("45.5"));
});
test("assistente: revogação cancela resposta já calculada antes de transmitir dados", async () => {
  const a = await fixture(); await receive(a.phone, await a.code());
  const reply = await receive(a.phone, "Olá"); assert.ok(reply);
  await db.membership.delete({ where: { userId_propertyId: { userId: a.user.id, propertyId: a.p.id } } });
  let calls = 0; await sendWhatsappReply(async () => { calls++; return randomUUID(); }, reply.id);
  assert.equal(calls, 0); assert.equal((await db.whatsappReply.findUniqueOrThrow({ where: { id: reply.id } })).status, "CANCELED");
  assert.match(response(await receive(a.phone, "Quanto diesel temos?")), /Conectar WhatsApp/);
});
test("assistente: desconectar invalida códigos e respostas pendentes; reconexão muda versão", async () => {
  const a = await fixture(); await receive(a.phone, await a.code());
  const old = await receive(a.phone, "Olá"); assert.ok(old);
  await receive(a.phone, await a.code());
  let calls = 0; await sendWhatsappReply(async () => { calls++; return randomUUID(); }, old.id); assert.equal(calls, 0);
  const code = await a.code();
  assert.equal((await a.post("/api/account/whatsapp/disconnect")).statusCode, 200);
  assert.equal(await db.whatsappConnection.count({ where: { userId: a.user.id } }), 0);
  assert.match(response(await receive(a.phone, code)), /inválido|indisponível/);
});
test("assistente: falha ambígua não reenvia; eventos de entrega não regridem", async () => {
  const a = await fixture(); await receive(a.phone, await a.code());
  const r = await receive(a.phone, "Olá"); assert.ok(r);
  let calls = 0;
  const timeout = async () => { calls++; throw new Error("timeout"); };
  await sendWhatsappReply(timeout, r.id); await sendWhatsappReply(timeout, r.id);
  assert.equal(calls, 1); assert.equal((await db.whatsappReply.findUniqueOrThrow({ where: { id: r.id } })).status, "UNKNOWN");
  const sent = await receive(a.phone, "ajuda"); assert.ok(sent);
  const externalId = randomUUID(); await sendWhatsappReply(async () => externalId, sent.id);
  for (const status of ["read", "sent"]) { const key = await message(a.phone, "", { id: externalId, status }, "status"); await processWhatsappEvent(key); }
  assert.equal((await db.whatsappReply.findUniqueOrThrow({ where: { id: sent.id } })).status, "READ");
});
test("assistente: evento antigo não responde; conteúdo indecifrável tem tentativas limitadas", async () => {
  const key = await message("556900000088", "Olá", { timestamp: "1" }); await processWhatsappEvent(key);
  assert.equal(await db.whatsappReply.count({ where: { eventKey: key } }), 0);
  const broken = await message("556900000077", "Olá"); await db.whatsappInboxEvent.update({ where: { eventKey: broken }, data: { encrypted: "broken" } });
  for (let i = 0; i < 7; i++) await processWhatsappEvent(broken);
  assert.equal((await db.whatsappInboxEvent.findUniqueOrThrow({ where: { eventKey: broken } })).attempts, 5);
});
test("assistente: limite de respostas por remetente", async () => {
  const phone = "556900000066";
  for (let i = 0; i < 11; i++) await receive(phone, "Olá");
  const { phoneHash } = await import("../src/whatsapp-crypto");
  assert.equal(await db.whatsappReply.count({ where: { recipientHash: phoneHash(phone) } }), 10);
});
test("assistente: adaptador envia texto com janela do provedor e classifica rejeição", async () => {
  const fetchOriginal = globalThis.fetch;
  process.env.WHATSAPP_ACCESS_TOKEN = "synthetic-token"; process.env.WHATSAPP_GRAPH_VERSION = "v26.0";
  const oldPhone = process.env.WHATSAPP_PHONE_NUMBER_ID; process.env.WHATSAPP_PHONE_NUMBER_ID = "synthetic-phone";
  try {
    globalThis.fetch = (async (url: string, options: RequestInit) => { assert.match(url, /v26.0\/synthetic-phone\/messages$/); const body = JSON.parse(options.body as string); assert.equal(body.to, "556900000055"); assert.equal(body.text.body, "Teste"); return new Response(JSON.stringify({ messages: [{ id: "sent-id" }] })); }) as typeof fetch;
    assert.equal(await metaSend("556900000055", "Teste"), "sent-id");
    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await assert.rejects(metaSend("556900000055", "Teste"), e => (e as { definite: boolean }).definite);
  } finally { globalThis.fetch = fetchOriginal; if (oldPhone === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID; else process.env.WHATSAPP_PHONE_NUMBER_ID = oldPhone; }
});

test("assistente: localhost não gera código para o bot publicado e informa o destino correto", async () => {
  const a = await fixture();
  delete process.env.WHATSAPP_ALLOW_LOCAL_PAIRING;
  try {
    const state = await app.inject({ url: "/api/account/whatsapp", headers: a.headers });
    assert.equal(state.json().pairingAvailable, false);
    assert.equal(state.json().pairingUrl, "https://agromind.ericksaymon.dev/app/assistant");
    const denied = await a.post("/api/account/whatsapp/code", { propertyId: a.p.id });
    assert.equal(denied.statusCode, 409); assert.equal(denied.json().code, "WHATSAPP_ENVIRONMENT_MISMATCH");
    assert.equal(await db.whatsappPairCode.count({ where: { sessionId: a.session.id } }), 0);
  } finally { process.env.WHATSAPP_ALLOW_LOCAL_PAIRING = "true"; }
});

test("assistente: código curto aceita hífen e minúsculas; tentativas limitadas mesmo com código correto", async () => {
  const a = await fixture();
  const code = await a.code();
  assert.match(code, /^AGROMIND [A-HJ-NP-Z2-9]{8}$/);
  const raw = code.split(" ")[1];
  assert.match(response(await receive(a.phone, `${raw.slice(0, 4)}-${raw.slice(4)}`.toLowerCase())), /conectado/);
  const b = await fixture(); const valid = await b.code();
  for (let i = 0; i < 5; i++) assert.match(response(await receive(b.phone, "AGROMIND ZZZZ-ZZZZ")), /Não encontrei.*publicado/);
  assert.match(response(await receive(b.phone, valid)), /Muitas tentativas/);
  assert.equal(await db.whatsappConnection.count({ where: { userId: b.user.id } }), 0);
  const { phoneHash } = await import("../src/whatsapp-crypto");
  await db.whatsappPairAttempt.updateMany({ where: { phoneHash: phoneHash(b.phone) }, data: { createdAt: new Date(Date.now() - 660_000) } });
  assert.match(response(await receive(b.phone, valid)), /conectado/);
});

test("assistente: áudio vira a mesma resposta do texto e falhas têm mensagem própria", async () => {
  const a = await fixture(); await receive(a.phone, await a.code());
  const category = await db.category.findFirstOrThrow({ where: { propertyId: a.p.id, nameKey: "combustiveis" } });
  await db.product.create({ data: { propertyId: a.p.id, name: "Diesel S10", nameKey: "diesel s10", category: category.name, categoryId: category.id, unit: "L", lots: { create: [{ code: "A", balance: "12", expiryStatus: "NA" }] } } });
  const voice = async (transcribe: typeof transcribeWhatsappAudio, phone = a.phone) => {
    const key = await message(phone, "", { type: "audio", audio: { id: "123456" } });
    assert.equal(await processWhatsappEvent(key, transcribe), true);
    return response(await db.whatsappReply.findUnique({ where: { eventKey: key } }));
  };
  const asked: string[] = [];
  const ok = await voice(async id => { asked.push(id); return "quanto diesel temos"; });
  assert.deepEqual(asked, ["123456"]);
  assert.match(ok, /Entendi: “quanto diesel temos”/); assert.match(ok, /Saldo físico: 12 L/);
  assert.match(await voice(async () => "Retire 20 litros de diesel"), /nenhuma alteração/);
  assert.equal(await db.stockMovement.count({ where: { product: { propertyId: a.p.id } } }), 0);
  for (const [code, pattern] of [["TOO_LARGE", /longo demais/], ["UNSUPPORTED", /formato/], ["EMPTY", /nenhuma fala/], ["NOT_CONFIGURED", /por texto/], ["UNAVAILABLE", /agora/]] as const)
    assert.match(await voice(async () => { throw new AudioError(code); }), pattern);
  assert.match(await voice(async () => { throw new Error("boom"); }), /agora/);
  let calls = 0;
  assert.match(await voice(async () => { calls++; return "quanto diesel temos"; }, "556900000055"), /Conectar WhatsApp/);
  assert.equal(calls, 0);
});

test("assistente: IA direciona perguntas livres, texto e áudio, e cai no texto original sem IA", async () => {
  const a = await fixture(); await receive(a.phone, await a.code());
  const category = await db.category.findFirstOrThrow({ where: { propertyId: a.p.id, nameKey: "combustiveis" } });
  await db.product.create({ data: { propertyId: a.p.id, name: "Diesel S10", nameKey: "diesel s10", category: category.name, categoryId: category.id, unit: "L", lots: { create: [{ code: "A", balance: "12", expiryStatus: "NA" }] } } });
  const ask = async (text: string, route: typeof routeWhatsappQuestion, extra: object = {}) => {
    const key = await message(a.phone, text, extra);
    assert.equal(await processWhatsappEvent(key, async () => "tem óleo no tanque?", route), true);
    return response(await db.whatsappReply.findUnique({ where: { eventKey: key } }));
  };
  const seen: { text: string; products: string[] }[] = [];
  const routed = async (text: string, products: string[]) => { seen.push({ text, products }); return "Quanto Diesel S10 temos?"; };
  assert.match(await ask("tenho combustível sobrando no tanque grande?", routed), /Saldo físico: 12 L/);
  assert.deepEqual(seen[0], { text: "tenho combustível sobrando no tanque grande?", products: ["Diesel S10"] });
  const voiced = await ask("", routed, { type: "audio", audio: { id: "99" } });
  assert.match(voiced, /Entendi: “tem óleo no tanque\?”/); assert.match(voiced, /Saldo físico/); assert.equal(seen[1].text, "tem óleo no tanque?");
  assert.match(await ask("quais produtos eu tenho?", async () => "Quais produtos temos?"), /1 produto\(s\).*Diesel S10/s);
  assert.match(await ask("Quanto diesel temos?", async () => null), /Saldo físico: 12 L/);
  assert.match(await ask("blablabla", async () => "ajuda"), /Posso consultar/);
  const code = await a.code(); let calls = 0;
  await ask(code, async () => { calls++; return null; }); assert.equal(calls, 0);
});

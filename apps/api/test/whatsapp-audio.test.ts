import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { AudioError, MAX_AUDIO_BYTES, transcribeWhatsappAudio } from "../src/whatsapp-audio";

const names = ["OPENROUTER_API_KEY", "OPENROUTER_AUDIO_MODEL", "OPENROUTER_MODEL", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_GRAPH_VERSION"];
const previous = names.map(k => process.env[k]);
afterEach(() => names.forEach((k, i) => { if (previous[i] === undefined) delete process.env[k]; else process.env[k] = previous[i]; }));
const configure = () => { process.env.OPENROUTER_API_KEY = "synthetic-openrouter"; process.env.WHATSAPP_ACCESS_TOKEN = "synthetic-meta"; delete process.env.OPENROUTER_AUDIO_MODEL; };
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const fail = async (promise: Promise<unknown>, code: string) => assert.rejects(promise, (e: unknown) => e instanceof AudioError && e.code === code);
type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const transport = (handler: Handler) => (async (input: unknown, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
const happy = (overrides: { meta?: object; audio?: () => Response; ai?: Handler } = {}): Handler => url => {
  if (url.startsWith("https://graph.facebook.com/")) return json({ url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/1", mime_type: "audio/ogg; codecs=opus", file_size: 1000, ...overrides.meta });
  if (url.startsWith("https://lookaside.fbsbx.com/")) return overrides.audio?.() ?? new Response(Buffer.from("OggS-synthetic"));
  return overrides.ai?.(url) ?? json({ choices: [{ finish_reason: "stop", message: { content: "  Quanto diesel   temos?  " } }] });
};

test("áudio: baixa da Meta, envia ao modelo em base64 e normaliza a transcrição", async () => {
  configure(); const seen: { url: string; auth: string | null; body?: string }[] = [];
  const text = await transcribeWhatsappAudio("98765", transport((url, init) => { seen.push({ url, auth: new Headers(init?.headers).get("authorization"), body: init?.body as string }); return happy()(url, init); }));
  assert.equal(text, "Quanto diesel temos?");
  assert.deepEqual(seen.map(s => s.auth), ["Bearer synthetic-meta", "Bearer synthetic-meta", "Bearer synthetic-openrouter"]);
  const body = JSON.parse(seen[2].body!);
  assert.equal(body.messages[1].content[0].input_audio.format, "ogg");
  assert.equal(Buffer.from(body.messages[1].content[0].input_audio.data, "base64").toString(), "OggS-synthetic");
  assert.equal(body.provider.data_collection, "deny");
  assert.ok(!seen[2].body!.includes("synthetic-meta"));
});
test("áudio: sem credenciais, mídia inválida, formato, tamanho e domínio externo são recusados", async () => {
  delete process.env.OPENROUTER_API_KEY; delete process.env.WHATSAPP_ACCESS_TOKEN;
  await fail(transcribeWhatsappAudio("1", transport(happy())), "NOT_CONFIGURED");
  configure();
  await fail(transcribeWhatsappAudio("../x", transport(happy())), "UNAVAILABLE");
  await fail(transcribeWhatsappAudio("1", transport(happy({ meta: { mime_type: "audio/amr" } }))), "UNSUPPORTED");
  await fail(transcribeWhatsappAudio("1", transport(happy({ meta: { mime_type: "video/mp4" } }))), "UNSUPPORTED");
  await fail(transcribeWhatsappAudio("1", transport(happy({ meta: { file_size: MAX_AUDIO_BYTES + 1 } }))), "TOO_LARGE");
  await fail(transcribeWhatsappAudio("1", transport(happy({ audio: () => new Response(Buffer.alloc(MAX_AUDIO_BYTES + 1)) }))), "TOO_LARGE");
  let leaked = false;
  await fail(transcribeWhatsappAudio("1", transport(url => { if (url.startsWith("https://evil.example")) leaked = true; return url.startsWith("https://graph") ? json({ url: "https://evil.example/a", mime_type: "audio/ogg" }) : json({}); })), "UNAVAILABLE");
  assert.equal(leaked, false);
});
test("áudio: falha da IA, resposta incompleta, vazia ou erro de rede viram erros controlados", async () => {
  configure();
  await fail(transcribeWhatsappAudio("1", transport(happy({ ai: () => new Response("", { status: 500 }) }))), "UNAVAILABLE");
  await fail(transcribeWhatsappAudio("1", transport(happy({ ai: () => json({ choices: [{ finish_reason: "length", message: { content: "oi" } }] }) }))), "UNAVAILABLE");
  await fail(transcribeWhatsappAudio("1", transport(happy({ ai: () => json({ choices: [{ finish_reason: "stop", message: { content: "VAZIO" } }] }) }))), "EMPTY");
  await fail(transcribeWhatsappAudio("1", transport(happy({ ai: () => json({}) }))), "UNAVAILABLE");
  await fail(transcribeWhatsappAudio("1", transport(() => { throw new Error("network"); })), "UNAVAILABLE");
});

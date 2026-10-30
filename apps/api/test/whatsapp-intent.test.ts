import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { routeWhatsappQuestion } from "../src/whatsapp-intent";

const previous = process.env.OPENROUTER_API_KEY;
afterEach(() => { if (previous === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previous; });
const answer = (content: unknown, finish = "stop") => (async () => new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(content) } }] }))) as unknown as typeof fetch;
const names = ["Adubo NPK", "Diesel S10"];

test("intenção: sem chave não chama a IA", async () => {
  delete process.env.OPENROUTER_API_KEY;
  assert.equal(await routeWhatsappQuestion("oi", names, (async () => { throw new Error("não deve chamar"); }) as typeof fetch), null);
});
test("intenção: converte intenção e produto em pergunta canônica e envia só nomes", async () => {
  process.env.OPENROUTER_API_KEY = "synthetic-key-not-a-real-credential";
  let sent = "";
  const spy = (async (_url: unknown, init?: RequestInit) => { sent = init!.body as string; return answer({ intent: "AUTONOMY", product: 1 })(_url as string); }) as typeof fetch;
  assert.equal(await routeWhatsappQuestion("quanto tempo meu óleo do trator dura?", names, spy), "Qual a autonomia do Diesel S10?");
  const body = JSON.parse(sent);
  assert.equal(body.provider.data_collection, "deny"); assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(JSON.parse(body.messages[1].content), { products: names, message: "quanto tempo meu óleo do trator dura?" });
  assert.equal(await routeWhatsappQuestion("x", names, answer({ intent: "BELOW_MINIMUM", product: -1 })), "O que está abaixo do mínimo?");
  assert.equal(await routeWhatsappQuestion("x", names, answer({ intent: "EXPIRY", product: -1 })), "O que está perto de vencer?");
  assert.equal(await routeWhatsappQuestion("x", names, answer({ intent: "MOVEMENT", product: 0 })), "Retire do estoque");
  assert.equal(await routeWhatsappQuestion("x", names, answer({ intent: "HELP", product: -1 })), "ajuda");
});
test("intenção: resposta inválida, incompleta ou falha viram null", async () => {
  process.env.OPENROUTER_API_KEY = "synthetic-key-not-a-real-credential";
  for (const t of [answer({ intent: "DROP_TABLE", product: -1 }), answer({ intent: "BALANCE", product: 9 }), answer({ intent: "BALANCE", product: 0.5 }), answer({ intent: "BALANCE", product: 0 }, "length"), (async () => new Response("", { status: 500 })) as unknown as typeof fetch, (async () => { throw new Error("rede"); }) as unknown as typeof fetch])
    assert.equal(await routeWhatsappQuestion("x", names, t), null);
  assert.equal(await routeWhatsappQuestion("   ", names, answer({ intent: "HELP", product: -1 })), null);
});

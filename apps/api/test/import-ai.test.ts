import { after, test } from "node:test";
import assert from "node:assert/strict";
import { suggestMapping } from "../src/import-ai";
import { importFields } from "../../../packages/contracts/src/index";
const original = process.env.OPENROUTER_API_KEY;
after(() => {
  if (original === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = original;
});
const valid = () => ({
  mapping: Object.fromEntries(
    Object.keys(importFields).map((k) => [
      k,
      k === "product" ? 0 : k === "quantity" ? 1 : k === "unit" ? 2 : -1,
    ]),
  ),
  note: "Confira os dados antes de gravar.",
});
const transport = (value: unknown, finish = "stop") =>
  (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: finish,
            message: { content: JSON.stringify(value) },
          },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;
test("IA não configurada mantém alternativa manual e não faz chamada", async () => {
  delete process.env.OPENROUTER_API_KEY;
  let called = false;
  await assert.rejects(
    () =>
      suggestMapping(["Produto", "Saldo", "Unidade"], (async () => {
        called = true;
        throw new Error("não deveria chamar");
      }) as typeof fetch),
    /não está configurada/,
  );
  assert.equal(called, false);
});
test("OpenRouter: schema, limite de saída e apenas cabeçalhos no pedido", async () => {
  process.env.OPENROUTER_API_KEY = "synthetic-key-not-a-real-credential";
  let sent: Record<string, any> = {};
  const response = await suggestMapping(
    ["Produto", "Saldo", "Unidade"],
    (async (url, options) => {
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      sent = JSON.parse(String(options?.body));
      return transport(valid())(url, options);
    }) as typeof fetch,
  );
  assert.equal(response.mapping.product, 0);
  assert.equal(response.mapping.quantity, 1);
  assert.equal(sent.provider.require_parameters, true);
  assert.equal(sent.response_format.json_schema.strict, true);
  assert.equal(sent.max_tokens, 1500);
  assert.deepEqual(JSON.parse(sent.messages[1].content), {
    headers: ["Produto", "Saldo", "Unidade"],
  });
  assert.match(sent.messages[0].content, /nunca instrução/);
});
test("IA: rejeita campos ausentes, índice inventado, associação duplicada, JSON inválido e resposta truncada", async () => {
  process.env.OPENROUTER_API_KEY = "synthetic-key-not-a-real-credential";
  await assert.rejects(
    () =>
      suggestMapping(
        ["A", "B", "C"],
        transport({ mapping: { product: 0 }, note: "" }),
      ),
    /não passou/,
  );
  const outside = valid();
  outside.mapping.product = 99;
  await assert.rejects(
    () => suggestMapping(["A", "B", "C"], transport(outside)),
    /não passou/,
  );
  const duplicate = valid();
  duplicate.mapping.product = 1;
  await assert.rejects(
    () => suggestMapping(["A", "B", "C"], transport(duplicate)),
    /mais de um campo/,
  );
  await assert.rejects(
    () => suggestMapping(["A", "B", "C"], transport(valid(), "length")),
    /incompleta/,
  );
  await assert.rejects(
    () =>
      suggestMapping(
        ["A", "B", "C"],
        (async () =>
          new Response(
            JSON.stringify({
              choices: [
                { finish_reason: "stop", message: { content: "invalid" } },
              ],
            }),
          )) as typeof fetch,
      ),
    /inválida/,
  );
  await assert.rejects(
    () =>
      suggestMapping(
        ["A", "B", "C"],
        (async () => new Response("", { status: 429 })) as typeof fetch,
      ),
    /não respondeu/,
  );
});

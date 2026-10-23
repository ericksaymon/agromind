import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app";

test("proxy: cabeçalho de IP só é aceito do endereço explicitamente confiável", async () => {
  const previous = process.env.API_TRUST_PROXY;
  try {
    process.env.API_TRUST_PROXY = "127.0.0.1";
    const app = await buildApp({ test: true });
    app.get("/__test_proxy_ip", async (request) => ({ ip: request.ip }));
    try {
      const trusted = await app.inject({ url: "/__test_proxy_ip", remoteAddress: "127.0.0.1", headers: { "x-forwarded-for": "203.0.113.9" } });
      assert.equal(trusted.json().ip, "203.0.113.9");
      const untrusted = await app.inject({ url: "/__test_proxy_ip", remoteAddress: "198.51.100.10", headers: { "x-forwarded-for": "203.0.113.9" } });
      assert.equal(untrusted.json().ip, "198.51.100.10");
    } finally { await app.close(); }
    delete process.env.API_TRUST_PROXY;
    const direct = await buildApp({ test: true });
    direct.get("/__test_proxy_ip", async (request) => ({ ip: request.ip }));
    try {
      const result = await direct.inject({ url: "/__test_proxy_ip", headers: { "x-forwarded-for": "203.0.113.9" } });
      assert.equal(result.json().ip, "127.0.0.1");
    } finally { await direct.close(); }
  } finally {
    if (previous === undefined) delete process.env.API_TRUST_PROXY;
    else process.env.API_TRUST_PROXY = previous;
  }
});

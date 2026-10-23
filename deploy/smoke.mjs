import assert from "node:assert/strict";
const origin = process.argv[2] || "https://agromind.ericksaymon.dev";
assert.equal(new URL(origin).protocol, "https:");
for (const path of ["/", "/demo", "/entrar", "/criar-conta", "/termos", "/privacidade", "/api/health"]) {
  const response = await fetch(new URL(path, origin));
  assert.equal(response.status, 200, path);
  if (path === "/privacidade") assert.match(await response.text(), /privacidade@ericksaymon\.dev/);
  console.log(`OK 200 ${path}`);
}
const privateData = await fetch(new URL("/api/account", origin));
assert.equal(privateData.status, 401);
for (const path of ["/.env", "/.private/production.env"]) {
  assert.equal((await fetch(new URL(path, origin))).status, 404, path);
}
const protectedPage = await fetch(new URL("/app", origin), { redirect: "manual" });
assert.equal(protectedPage.status, 307);
assert.match(protectedPage.headers.get("location"), /\/entrar$/);
const csrf = await fetch(new URL("/api/auth/csrf", origin));
const setCookies = csrf.headers.getSetCookie();
assert(setCookies.length > 0);
assert(setCookies.every(value => /; Secure/i.test(value) && /SameSite=Lax/i.test(value)));
const cookie = setCookies.map(value => value.split(";")[0]).join("; ");
const { token } = await csrf.json();
const invalid = await fetch(new URL("/api/auth/register", origin), {
  method: "POST",
  headers: { "content-type": "application/json", origin, cookie, "x-csrf-token": token },
  body: JSON.stringify({ name: "", email: "invalid", password: "short", terms: false }),
});
assert.equal(invalid.status, 400);
const forged = await fetch(new URL("/api/auth/login", origin), {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://example.invalid", cookie, "x-csrf-token": token },
  body: JSON.stringify({ email: "probe@example.invalid", password: "Invalid123" }),
});
assert.equal(forged.status, 403);
console.log("OK acesso privado, cookies Secure, validação e origem. Nenhuma conta criada.");

import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const file = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(file)) {
  if (!/^MAIL_ENCRYPTION_KEY=/m.test(readFileSync(file, "utf8"))) appendFileSync(file, `\nMAIL_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}\n`.replaceAll("\\n", "\n"));
  console.log(".env existente preservado; chave de e-mail preparada.");
} else {
  const password = randomBytes(24).toString("hex");
  writeFileSync(file, `APP_ENV=local\nAPP_ORIGIN=http://localhost:3000\nAPI_PORT=4000\nPOSTGRES_PASSWORD=${password}\nDATABASE_URL=postgresql://agromind:${password}@127.0.0.1:55432/agromind\nCSRF_SECRET=${randomBytes(32).toString("hex")}\nMAIL_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}\nSMTP_HOST=127.0.0.1\nSMTP_PORT=11025\nSMTP_FROM=AgroMind <nao-responda@agromind.local>\n`, { mode: 0o600 });
  console.log("Configuração local criada. Valores privados não foram exibidos.");
}

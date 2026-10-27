import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
function key() {
  const raw = process.env.WHATSAPP_INBOX_KEY || "";
  if (!/^[a-f0-9]{64}$/i.test(raw)) throw new Error("WHATSAPP_KEY_UNAVAILABLE");
  return Buffer.from(raw, "hex");
}
export function phoneHash(phone: string) { return createHmac("sha256", key()).update(phone).digest("hex"); }
export function encryptWhatsapp(value: unknown) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(v => v.toString("base64")).join(".");
}
export function decryptWhatsapp<T>(raw: string): T {
  const [iv, tag, data] = raw.split(".").map(v => Buffer.from(v, "base64"));
  const cipher = createDecipheriv("aes-256-gcm", key(), iv); cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8")) as T;
}

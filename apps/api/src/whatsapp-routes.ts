import { createCipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { db } from "./db";
import { failure } from "./security";

export const WHATSAPP_WEBHOOK_PATH = "/api/webhooks/whatsapp";
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : null;
const equal = (a: string, b: string) => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

function configuration() {
  const secret = process.env.WHATSAPP_APP_SECRET;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  const phone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accounts = (process.env.WHATSAPP_ACCOUNT_IDS || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "").split(",").map(v => v.trim()).filter(Boolean);
  const key = process.env.WHATSAPP_INBOX_KEY || "";
  if (!secret || !token || token.length < 32 || !phone || !accounts.length || !/^[a-f0-9]{64}$/i.test(key)) failure(503, "Canal indisponível.", "WHATSAPP_NOT_CONFIGURED");
  return { secret, token, phone, accounts, key: Buffer.from(key, "hex") };
}

export function validWhatsappSignature(raw: Buffer, signature: unknown, secret: string) {
  if (typeof signature !== "string" || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  return equal(signature.slice(7), expected);
}

function encrypt(value: unknown, key: Buffer) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(v => v.toString("base64")).join(".");
}

export async function registerWhatsappRoutes(app: FastifyInstance) {
  await app.register(async webhook => {
    // Encapsulation keeps the JSON parser used by browser routes unchanged.
    webhook.removeContentTypeParser("application/json");
    webhook.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
    const options = { logLevel: "silent" as const, config: { rateLimit: { max: 600, timeWindow: "1 minute" } } };
    webhook.get<{ Querystring: Record<string, unknown> }>(WHATSAPP_WEBHOOK_PATH, options, async (request, reply) => {
      const config = configuration(), query = request.query;
      if (query["hub.mode"] !== "subscribe" || typeof query["hub.verify_token"] !== "string" || !equal(query["hub.verify_token"], config.token) || typeof query["hub.challenge"] !== "string" || query["hub.challenge"].length > 512) failure(403, "Verificação inválida.", "INVALID_WEBHOOK_VERIFICATION");
      return reply.type("text/plain").send(query["hub.challenge"]);
    });
    webhook.post(WHATSAPP_WEBHOOK_PATH, { ...options, bodyLimit: 1_048_576 }, async (request, reply) => {
      const config = configuration();
      if (!Buffer.isBuffer(request.body) || !validWhatsappSignature(request.body, request.headers["x-hub-signature-256"], config.secret)) failure(401, "Assinatura inválida.", "INVALID_WEBHOOK_SIGNATURE");
      let body: ObjectValue | null;
      try { body = object(JSON.parse(request.body.toString("utf8"))); } catch { failure(400, "Evento inválido.", "INVALID_WEBHOOK_PAYLOAD"); }
      if (!body || body.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) failure(400, "Evento inválido.", "INVALID_WEBHOOK_PAYLOAD");
      const events: { eventKey: string; accountId: string; phoneNumberId: string; kind: string; encrypted: string }[] = [];
      for (const rawEntry of body.entry) {
        const entry = object(rawEntry);
        if (!entry || typeof entry.id !== "string" || !config.accounts.includes(entry.id) || !Array.isArray(entry.changes)) continue;
        for (const rawChange of entry.changes) {
          const change = object(rawChange), value = object(change?.value), metadata = object(value?.metadata);
          if (change?.field !== "messages" || !value || metadata?.phone_number_id !== config.phone) continue;
          for (const kind of ["message", "status"] as const) {
            const items = value[kind === "message" ? "messages" : "statuses"];
            if (items === undefined) continue;
            if (!Array.isArray(items)) failure(400, "Evento inválido.", "INVALID_WEBHOOK_PAYLOAD");
            for (const rawItem of items) {
              const item = object(rawItem);
              if (!item || typeof item.id !== "string" || item.id.length > 512 || (kind === "status" && (typeof item.status !== "string" || typeof item.timestamp !== "string"))) failure(400, "Evento inválido.", "INVALID_WEBHOOK_PAYLOAD");
              const eventKey = createHash("sha256").update(JSON.stringify([entry.id, config.phone, kind, item.id, ...(kind === "status" ? [item.status, item.timestamp] : [])])).digest("hex");
              events.push({ eventKey, accountId: entry.id, phoneNumberId: config.phone, kind, encrypted: encrypt(item, config.key) });
              if (events.length > 500) failure(400, "Evento excede o limite.", "INVALID_WEBHOOK_PAYLOAD");
            }
          }
        }
      }
      // One transaction, unique event keys and acknowledgement only after commit.
      const stored = await db.$transaction(async tx => {
        await tx.whatsappInboxEvent.deleteMany({ where: { receivedAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } });
        return events.length ? tx.whatsappInboxEvent.createMany({ data: events, skipDuplicates: true }) : { count: 0 };
      });
      app.log.info({ received: events.length, stored: stored.count }, "WHATSAPP_WEBHOOK_RECEIVED");
      return reply.code(200).send({ ok: true });
    });
  });
}

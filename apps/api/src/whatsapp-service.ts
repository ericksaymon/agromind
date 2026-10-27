import { db } from "./db";
import { digest } from "./security";
import { audit, userLocks } from "./administration-service";
import { decryptWhatsapp, encryptWhatsapp, phoneHash } from "./whatsapp-crypto";
import type { Tx } from "./stock-service";
import { whatsappAnswer, whatsappHelp } from "./whatsapp-query";
type Incoming = { id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string }; status?: string };
type Envelope = { to: string; text: string };

async function liveConnection(tx: Tx, id: string, version?: number) {
  const original = await tx.whatsappConnection.findUnique({ where: { id } });
  if (!original) return null;
  await userLocks(tx, [original.userId]);
  const current = await tx.whatsappConnection.findUnique({ where: { id } });
  if (!current) return null;
  await tx.$queryRaw`SELECT id FROM "Property" WHERE id=${current.propertyId}::uuid FOR SHARE`;
  const fresh = await tx.whatsappConnection.findUnique({ where: { id }, include: { user: true, property: true } });
  if (!fresh || (version !== undefined && fresh.version !== version) || !fresh.user.emailVerifiedAt) return null;
  const member = await tx.membership.findUnique({ where: { userId_propertyId: { userId: fresh.userId, propertyId: fresh.propertyId } } });
  return member ? fresh : null;
}

export async function processWhatsappEvent(eventKey?: string) {
  let selected: string | undefined;
  try {
    return await db.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ eventKey: string }[]>`SELECT "eventKey" FROM "WhatsappInboxEvent" WHERE "processedAt" IS NULL AND attempts<5 AND (${eventKey ?? null}::text IS NULL OR "eventKey"=${eventKey ?? null}) ORDER BY "receivedAt","eventKey" LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!rows.length) return false;
      selected = rows[0].eventKey;
      const event = await tx.whatsappInboxEvent.findUniqueOrThrow({ where: { eventKey: selected } });
      const item = decryptWhatsapp<Incoming>(event.encrypted);
      const done = () => tx.whatsappInboxEvent.update({ where: { eventKey: event.eventKey }, data: { processedAt: new Date(), lastError: null } });
      if (event.kind === "status") {
        const states: Record<string, string> = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" };
        const next = states[item.status || ""];
        const reply = item.id && await tx.whatsappReply.findUnique({ where: { externalId: item.id } });
        const rank: Record<string, number> = { ACCEPTED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 1 };
        if (reply && next && (rank[next] ?? 0) > (rank[reply.status] ?? -1)) await tx.whatsappReply.update({ where: { id: reply.id }, data: { status: next } });
        await done(); return true;
      }
      const sentAt = Number(item.timestamp) * 1000, now = Date.now();
      if (!item.from || !/^\d{8,15}$/.test(item.from) || !Number.isFinite(sentAt) || sentAt < now - 23 * 3_600_000 || sentAt > now + 300_000) { await done(); return true; }
      const hash = phoneHash(item.from);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hash},0))::text`;
      const text = typeof item.text?.body === "string" ? item.text.body.trim() : "";
      const code = /^AGROMIND\s+([a-f0-9]{32})$/i.exec(text);
      let connection = null as Awaited<ReturnType<typeof liveConnection>>;
      let response: string;
      if (code) {
        const pairing = await tx.whatsappPairCode.findUnique({ where: { hash: digest(code[1].toLowerCase()) }, include: { session: { include: { user: true } } } });
        if (!pairing) response = "Código inválido ou expirado. Gere outro em Assistente, dentro do painel AgroMind.";
        else {
          await userLocks(tx, [pairing.session.userId]);
          await tx.$queryRaw`SELECT id FROM "Property" WHERE id=${pairing.propertyId}::uuid FOR SHARE`;
          const fresh = await tx.whatsappPairCode.findUnique({ where: { hash: pairing.hash }, include: { session: { include: { user: true } } } });
          const membership = await tx.membership.findUnique({ where: { userId_propertyId: { userId: pairing.session.userId, propertyId: pairing.propertyId } }, include: { property: true } });
          const owner = await tx.whatsappConnection.findUnique({ where: { phoneHash: hash } });
          if (!fresh || fresh.usedAt || fresh.expiresAt <= new Date() || fresh.createdAt.getTime() > sentAt + 300_000 || fresh.session.expiresAt <= new Date() || !fresh.session.user.emailVerifiedAt || !membership || (owner && owner.userId !== pairing.session.userId)) response = "Código inválido ou indisponível. Confira sua conexão no painel e gere outro código.";
          else {
            const used = await tx.whatsappPairCode.updateMany({ where: { hash: fresh.hash, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
            if (used.count !== 1) throw new Error("PAIRING_RACE");
            const previous = await tx.whatsappConnection.findUnique({ where: { userId: fresh.session.userId } });
            if (previous) await tx.whatsappReply.updateMany({ where: { connectionId: previous.id, status: "QUEUED" }, data: { status: "CANCELED", encrypted: "" } });
            const linked = await tx.whatsappConnection.upsert({ where: { userId: fresh.session.userId }, create: { userId: fresh.session.userId, propertyId: fresh.propertyId, phoneHash: hash, encryptedPhone: encryptWhatsapp(item.from), lastDigits: item.from.slice(-4), lastMessageAt: new Date(sentAt) }, update: { propertyId: fresh.propertyId, phoneHash: hash, encryptedPhone: encryptWhatsapp(item.from), lastDigits: item.from.slice(-4), version: { increment: 1 }, createdAt: new Date(), lastMessageAt: new Date(sentAt) } });
            await audit(tx, fresh.session, fresh.propertyId, "WHATSAPP_CONNECTED", "Vínculo confirmado por mensagem com código de uso único", { lastDigits: item.from.slice(-4) });
            connection = await liveConnection(tx, linked.id);
            response = `WhatsApp conectado à propriedade ${membership.property.name}.\n${whatsappHelp}`;
          }
        }
      } else {
        const linked = await tx.whatsappConnection.findUnique({ where: { phoneHash: hash } });
        connection = linked ? await liveConnection(tx, linked.id) : null;
        if (!connection) response = "Para consultar seus dados, entre no AgroMind e abra Assistente → Conectar WhatsApp. Envie o código gerado pelo painel nesta conversa.";
        else {
          await tx.whatsappConnection.update({ where: { id: connection.id }, data: { lastMessageAt: new Date(Math.max(connection.lastMessageAt.getTime(), sentAt)) } });
          response = item.type === "text" ? await whatsappAnswer(tx, connection.property, text) : "Por enquanto, envie sua pergunta por texto. Áudios e outros anexos ainda não são interpretados.";
        }
      }
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('whatsapp-replies-global',0))::text`;
      const recent = await tx.whatsappReply.count({ where: { createdAt: { gt: new Date(now - 60_000) } } });
      const personal = await tx.whatsappReply.count({ where: { recipientHash: hash, createdAt: { gt: new Date(now - 60_000) } } });
      if (recent < 120 && personal < 10) await tx.whatsappReply.upsert({ where: { eventKey: event.eventKey }, update: {}, create: { eventKey: event.eventKey, recipientHash: hash, encrypted: encryptWhatsapp({ to: item.from, text: response.slice(0, 3900) }), connectionId: connection?.id, connectionVersion: connection?.version, expiresAt: new Date(Math.min(sentAt + 23 * 3_600_000, now + 300_000)) } });
      await done(); return true;
    }, { timeout: 15000 });
  } catch {
    if (selected) await db.whatsappInboxEvent.updateMany({ where: { eventKey: selected, processedAt: null }, data: { attempts: { increment: 1 }, lastError: "PROCESSING_FAILED" } });
    return false;
  }
}

export async function metaSend(to: string, text: string) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN, phone = process.env.WHATSAPP_PHONE_NUMBER_ID, version = process.env.WHATSAPP_GRAPH_VERSION || "v26.0";
  if (!token || !phone || !/^v\d+\.\d+$/.test(version)) throw new Error("TRANSPORT_UNAVAILABLE");
  const response = await fetch(`https://graph.facebook.com/${version}/${phone}/messages`, { method: "POST", signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text, preview_url: false } }) });
  if (!response.ok) throw Object.assign(new Error("META_REJECTED"), { definite: response.status >= 400 && response.status < 500 });
  const data = await response.json() as { messages?: { id?: string }[] };
  if (!data.messages?.[0]?.id) throw new Error("META_RESPONSE_UNKNOWN");
  return data.messages[0].id;
}

export async function sendWhatsappReply(send = metaSend, replyId?: string) {
  if (send === metaSend && !process.env.WHATSAPP_ACCESS_TOKEN) return false;
  const claimed = await db.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "WhatsappReply" WHERE status='QUEUED' AND (${replyId ?? null}::uuid IS NULL OR id=${replyId ?? null}::uuid) ORDER BY "createdAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;
    return rows.length ? tx.whatsappReply.update({ where: { id: rows[0].id }, data: { status: "SENDING" } }) : null;
  });
  if (!claimed) return false;
  try {
    await db.$transaction(async tx => {
      const connection = claimed.connectionId ? await liveConnection(tx, claimed.connectionId, claimed.connectionVersion ?? undefined) : null;
      if (claimed.expiresAt <= new Date() || (claimed.connectionId && !connection)) { await tx.whatsappReply.update({ where: { id: claimed.id }, data: { status: "CANCELED", encrypted: "" } }); return; }
      const envelope = decryptWhatsapp<Envelope>(claimed.encrypted);
      const externalId = await send(envelope.to, envelope.text);
      await tx.whatsappReply.update({ where: { id: claimed.id }, data: { status: "ACCEPTED", externalId } });
    }, { timeout: 15000 });
  } catch (error) {
    await db.whatsappReply.updateMany({ where: { id: claimed.id, status: "SENDING" }, data: { status: (error as { definite?: boolean }).definite ? "FAILED" : "UNKNOWN", errorCode: "SEND_NOT_CONFIRMED" } });
  }
  return true;
}

export function startWhatsappWorker(log: { error: (details: object, message: string) => void }) {
  let running: Promise<void> | null = null;
  const run = () => {
    if (running || process.env.WHATSAPP_WORKER_ENABLED !== "true" || !process.env.WHATSAPP_INBOX_KEY) return;
    running = (async () => {
      for (let n = 0; n < 10; n++) if (!await processWhatsappEvent()) break;
      for (let n = 0; n < 10; n++) if (!await sendWhatsappReply()) break;
      await db.whatsappReply.updateMany({ where: { status: "SENDING", updatedAt: { lt: new Date(Date.now() - 60_000) } }, data: { status: "UNKNOWN", errorCode: "INTERRUPTED_SEND" } });
      await db.whatsappReply.updateMany({ where: { encrypted: { not: "" }, createdAt: { lt: new Date(Date.now() - 7 * 86_400_000) } }, data: { encrypted: "" } });
    })().catch(() => log.error({ code: "WHATSAPP_WORKER_FAILED" }, "Falha no ciclo WhatsApp; nova tentativa automática.")).finally(() => { running = null; });
  };
  const timer = setInterval(run, 2000); timer.unref(); run();
  return async () => { clearInterval(timer); await running; };
}

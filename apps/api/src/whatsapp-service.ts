import { db } from "./db";
import { digest } from "./security";
import { audit, userLocks } from "./administration-service";
import { decryptWhatsapp, encryptWhatsapp, phoneHash } from "./whatsapp-crypto";
import type { Tx } from "./stock-service";
import { whatsappAnswer, whatsappHelp } from "./whatsapp-query";
import { parseWhatsappPairCode } from "./whatsapp-pairing";
import { extractWhatsappMovement, MOVEMENT_QUESTION, routeWhatsappQuestion, type Movement } from "./whatsapp-intent";
import { cancelPending, confirmPending, isCancel, isConfirm, proposeDisconnect, proposeMovement, wantsDisconnect } from "./whatsapp-actions";
import { AudioError, audioFailureMessage, transcribeWhatsappAudio } from "./whatsapp-audio";
type Incoming = { id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string }; audio?: { id?: string }; status?: string };
type Prepared = { eventKey: string; heard?: string; failure?: AudioError["code"]; routed?: string | null; movement?: Movement | null };
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

// A IA é chamada antes da transação para não segurar travas durante a rede, e só para telefones já vinculados.
async function prepareMessage(eventKey: string | undefined, transcribe: typeof transcribeWhatsappAudio, route: typeof routeWhatsappQuestion, extract: typeof extractWhatsappMovement): Promise<Prepared | undefined> {
  const rows = await db.$queryRaw<{ eventKey: string }[]>`SELECT "eventKey" FROM "WhatsappInboxEvent" WHERE kind='message' AND "processedAt" IS NULL AND attempts<5 AND (${eventKey ?? null}::text IS NULL OR "eventKey"=${eventKey ?? null}) ORDER BY "receivedAt","eventKey" LIMIT 1`;
  const event = rows.length ? await db.whatsappInboxEvent.findUnique({ where: { eventKey: rows[0].eventKey } }) : null;
  if (!event?.encrypted) return undefined;
  let item: Incoming;
  try { item = decryptWhatsapp<Incoming>(event.encrypted); } catch { return undefined; }
  const sentAt = Number(item.timestamp) * 1000, now = Date.now();
  if ((item.type !== "audio" && item.type !== "text") || !item.from || !/^\d{8,15}$/.test(item.from) || !Number.isFinite(sentAt) || sentAt < now - 23 * 3_600_000 || sentAt > now + 300_000) return undefined;
  const linked = await db.whatsappConnection.findUnique({ where: { phoneHash: phoneHash(item.from) } });
  if (!linked) return undefined;
  const prepared: Prepared = { eventKey: event.eventKey };
  let question = typeof item.text?.body === "string" ? item.text.body.trim() : "";
  if (item.type === "audio") {
    try { question = prepared.heard = await transcribe(item.audio?.id || ""); }
    catch (error) { return { ...prepared, failure: error instanceof AudioError ? error.code : "UNAVAILABLE" }; }
  } else if (parseWhatsappPairCode(question)) return undefined;
  if (isConfirm(question) || isCancel(question)) return undefined;
  const products = await db.product.findMany({ where: { propertyId: linked.propertyId, archived: false }, select: { name: true, unit: true }, orderBy: { name: "asc" }, take: 200 });
  prepared.routed = await route(question, products.map(p => p.name));
  if (prepared.routed === MOVEMENT_QUESTION) prepared.movement = await extract(question, products);
  return prepared;
}

export async function processWhatsappEvent(eventKey?: string, transcribe = transcribeWhatsappAudio, route = routeWhatsappQuestion, extract = extractWhatsappMovement) {
  let selected: string | undefined;
  try {
    const prepared = await prepareMessage(eventKey, transcribe, route, extract);
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
      const code = parseWhatsappPairCode(text);
      let connection = null as Awaited<ReturnType<typeof liveConnection>>;
      let response: string;
      if (code) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('whatsapp-code-attempts',0))::text`;
        const window = new Date(now - 600_000);
        const tries = await tx.whatsappPairAttempt.count({ where: { phoneHash: hash, createdAt: { gt: window } } });
        const total = await tx.whatsappPairAttempt.count({ where: { createdAt: { gt: window } } });
        const limited = tries >= 5 || total >= 1000;
        if (!limited) await tx.whatsappPairAttempt.create({ data: { eventKey: event.eventKey, phoneHash: hash } });
        const pairing = limited ? null : await tx.whatsappPairCode.findUnique({ where: { hash: digest(code) }, include: { session: { include: { user: true } } } });
        if (limited) response = "Muitas tentativas de conexão. Aguarde dez minutos e gere um novo código no painel publicado: https://agromind.ericksaymon.dev/app/assistant";
        else if (!pairing) response = "Não encontrei esse código no AgroMind publicado. Abra https://agromind.ericksaymon.dev/app/assistant e gere outro. Códigos gerados no localhost não funcionam nesta conversa.";
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
          const ready = prepared?.eventKey === event.eventKey ? prepared : undefined;
          const spoken = item.type === "text" ? text : ready?.heard ?? "";
          if (item.type === "text" && isConfirm(text)) { const done = await confirmPending(tx, connection, event.eventKey); response = done.response; if (done.unlinked) connection = null; }
          else if (item.type === "text" && isCancel(text)) response = await cancelPending(tx, connection);
          else if (spoken && (wantsDisconnect(spoken) || ready?.routed === MOVEMENT_QUESTION)) {
            const prefix = item.type === "audio" ? `Entendi: “${spoken}”\n\n` : "";
            response = prefix + (wantsDisconnect(spoken) ? await proposeDisconnect(tx, connection) : await proposeMovement(tx, connection, ready?.movement ?? null));
          }
          else if (item.type === "text") { await tx.whatsappPendingAction.deleteMany({ where: { connectionId: connection.id } }); response = await whatsappAnswer(tx, connection.property, ready?.routed ?? text); }
          else if (item.type === "audio") {
            response = ready?.heard ? `Entendi: “${ready.heard}”\n\n${await whatsappAnswer(tx, connection.property, ready.routed ?? ready.heard)}` : audioFailureMessage[ready?.failure ?? "UNAVAILABLE"];
          } else response = "Por enquanto, envie sua pergunta por texto ou por mensagem de voz. Outros anexos ainda não são interpretados.";
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
      await db.whatsappPairAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 86400000) } } });
    })().catch(() => log.error({ code: "WHATSAPP_WORKER_FAILED" }, "Falha no ciclo WhatsApp; nova tentativa automática.")).finally(() => { running = null; });
  };
  const timer = setInterval(run, 2000); timer.unref(); run();
  return async () => { clearInterval(timer); await running; };
}

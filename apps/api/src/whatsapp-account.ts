import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { db } from "./db";
import { digest, failure, requireSession } from "./security";
import { audit, currentSession, propertyAccess, userLocks } from "./administration-service";
import { newWhatsappPairCode, whatsappPairingAvailable } from "./whatsapp-pairing";

export async function registerWhatsappAccount(app: FastifyInstance) {
  app.get("/api/account/whatsapp", async request => {
    const session = await requireSession(request, true);
    const connection = await db.whatsappConnection.findUnique({ where: { userId: session.userId }, include: { property: { select: { name: true } } } });
    const access = connection && await db.membership.findUnique({ where: { userId_propertyId: { userId: session.userId, propertyId: connection.propertyId } } });
    const latest = connection && await db.whatsappReply.findFirst({ where: { connectionId: connection.id }, orderBy: { createdAt: "desc" }, select: { status: true, errorCode: true, updatedAt: true } });
    return { connection: connection ? { propertyId: connection.propertyId, propertyName: access ? connection.property.name : null, lastDigits: connection.lastDigits, connectedAt: connection.createdAt, lastMessageAt: connection.lastMessageAt, access: !!access } : null,
      pairingAvailable: whatsappPairingAvailable(), pairingUrl: "https://agromind.ericksaymon.dev/app/assistant", transportReady: !!process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_WORKER_ENABLED === "true", businessPhone: process.env.WHATSAPP_PUBLIC_NUMBER || "", latestReply: latest || null };
  });
  app.post<{ Body: { propertyId: string } }>("/api/account/whatsapp/code", { schema: { body: Type.Object({ propertyId: Type.String({ format: "uuid" }) }, { additionalProperties: false }) }, config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async request => {
    const session = await requireSession(request, true);
    if (!whatsappPairingAvailable()) failure(409, "O WhatsApp recebe as mensagens no AgroMind publicado. Conecte seu telefone em https://agromind.ericksaymon.dev/app/assistant. Sua conta e seus dados locais são separados.", "WHATSAPP_ENVIRONMENT_MISMATCH");
    if (!process.env.WHATSAPP_INBOX_KEY || !process.env.WHATSAPP_PUBLIC_NUMBER) failure(503, "A conexão WhatsApp ainda não está configurada.");
    let code = newWhatsappPairCode();
    const expiresAt = new Date(Date.now() + 600_000);
    code = await db.$transaction(async tx => {
      await userLocks(tx, [session.userId]);
      await propertyAccess(tx, session, request.body.propertyId, false);
      await tx.whatsappPairCode.updateMany({ where: { session: { userId: session.userId }, usedAt: null }, data: { usedAt: new Date() } });
      // Serialize the small code namespace and retry the astronomically rare collision.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('whatsapp-code-generation',0))::text`;
      let candidate = code;
      for (let n = 0; await tx.whatsappPairCode.findUnique({ where: { hash: digest(candidate.toLowerCase()) } }); n++) {
        if (n >= 5) failure(503, "Não foi possível gerar o código. Tente novamente.");
        candidate = newWhatsappPairCode();
      }
      await tx.whatsappPairCode.create({ data: { hash: digest(candidate.toLowerCase()), sessionId: session.id, propertyId: request.body.propertyId, expiresAt } });
      return candidate;
    });
    const message = `AGROMIND ${code}`;
    return { shortCode: `${code.slice(0, 4)}-${code.slice(4)}`, message, expiresAt: expiresAt.toISOString(), url: `https://wa.me/${process.env.WHATSAPP_PUBLIC_NUMBER!.replace(/\D/g, "")}?text=${encodeURIComponent(message)}` };
  });
  app.post("/api/account/whatsapp/disconnect", { schema: { body: Type.Object({}, { additionalProperties: false }) } }, async request => {
    const session = await requireSession(request, true);
    await db.$transaction(async tx => {
      await userLocks(tx, [session.userId]);
      const fresh = await currentSession(tx, session, true);
      const connection = await tx.whatsappConnection.findUnique({ where: { userId: session.userId } });
      await tx.whatsappPairCode.updateMany({ where: { session: { userId: session.userId }, usedAt: null }, data: { usedAt: new Date() } });
      if (connection) {
        await tx.whatsappReply.updateMany({ where: { connectionId: connection.id, status: "QUEUED" }, data: { status: "CANCELED", encrypted: "" } });
        await tx.whatsappConnection.delete({ where: { id: connection.id } });
        await audit(tx, fresh, connection.propertyId, "WHATSAPP_DISCONNECTED", "Desconexão pelo titular", { lastDigits: connection.lastDigits });
      }
    });
    return { ok: true };
  });
}

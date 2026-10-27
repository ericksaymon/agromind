import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { db } from "./db";
import { digest, failure, requireSession } from "./security";
import { audit, currentSession, propertyAccess, userLocks } from "./administration-service";

export async function registerWhatsappAccount(app: FastifyInstance) {
  app.get("/api/account/whatsapp", async request => {
    const session = await requireSession(request, true);
    const connection = await db.whatsappConnection.findUnique({ where: { userId: session.userId }, include: { property: { select: { name: true } } } });
    const access = connection && await db.membership.findUnique({ where: { userId_propertyId: { userId: session.userId, propertyId: connection.propertyId } } });
    const latest = connection && await db.whatsappReply.findFirst({ where: { connectionId: connection.id }, orderBy: { createdAt: "desc" }, select: { status: true, errorCode: true, updatedAt: true } });
    return { connection: connection ? { propertyId: connection.propertyId, propertyName: access ? connection.property.name : null, lastDigits: connection.lastDigits, connectedAt: connection.createdAt, lastMessageAt: connection.lastMessageAt, access: !!access } : null,
      transportReady: !!process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_WORKER_ENABLED === "true", businessPhone: process.env.WHATSAPP_PUBLIC_NUMBER || "", latestReply: latest || null };
  });
  app.post<{ Body: { propertyId: string } }>("/api/account/whatsapp/code", { schema: { body: Type.Object({ propertyId: Type.String({ format: "uuid" }) }, { additionalProperties: false }) }, config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async request => {
    const session = await requireSession(request, true);
    if (!process.env.WHATSAPP_INBOX_KEY || !process.env.WHATSAPP_PUBLIC_NUMBER) failure(503, "A conexão WhatsApp ainda não está configurada.");
    const code = randomBytes(16).toString("hex"), expiresAt = new Date(Date.now() + 600_000);
    await db.$transaction(async tx => {
      await userLocks(tx, [session.userId]);
      await propertyAccess(tx, session, request.body.propertyId, false);
      await tx.whatsappPairCode.updateMany({ where: { session: { userId: session.userId }, usedAt: null }, data: { usedAt: new Date() } });
      await tx.whatsappPairCode.create({ data: { hash: digest(code), sessionId: session.id, propertyId: request.body.propertyId, expiresAt } });
    });
    const message = `AGROMIND ${code}`;
    return { message, expiresAt: expiresAt.toISOString(), url: `https://wa.me/${process.env.WHATSAPP_PUBLIC_NUMBER!.replace(/\D/g, "")}?text=${encodeURIComponent(message)}` };
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

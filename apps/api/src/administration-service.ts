import { randomUUID } from "node:crypto";
import { failure } from "./security";
import type { Tx } from "./stock-service";
import type { Prisma } from "./generated/prisma/client";

export type Identity = { id: string; userId: string };
export async function userLocks(tx: Tx, ids: string[]) {
  for (const id of [...new Set(ids)].sort())
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id}::uuid FOR UPDATE`;
}
export async function currentSession(
  tx: Tx,
  identity: Identity,
  verified = false,
) {
  await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${identity.id}::uuid FOR SHARE`;
  const session = await tx.session.findUnique({
    where: { id: identity.id },
    include: { user: true },
  });
  if (
    !session ||
    session.userId !== identity.userId ||
    session.expiresAt <= new Date()
  )
    failure(401, "Sua sessão expirou. Entre novamente.", "UNAUTHENTICATED");
  if (verified && !session.user.emailVerifiedAt)
    failure(403, "Confirme seu e-mail.", "EMAIL_NOT_VERIFIED");
  return session;
}
export async function propertyAccess(
  tx: Tx,
  identity: Identity,
  propertyId: string,
  admin = true,
) {
  await tx.$queryRaw`SELECT id FROM "Property" WHERE id=${propertyId}::uuid FOR UPDATE`;
  const session = await currentSession(tx, identity, true);
  const membership = await tx.membership.findUnique({
    where: { userId_propertyId: { userId: session.userId, propertyId } },
    include: { property: true },
  });
  if (!membership) failure(404, "Propriedade não encontrada.", "NOT_FOUND");
  if (admin && membership.role !== "ADMIN")
    failure(403, "Apenas administradores podem fazer isso.", "FORBIDDEN");
  return { session, membership, property: membership.property };
}
export function recentAuthentication(session: {
  reauthenticatedAt: Date | null;
}) {
  if (
    !session.reauthenticatedAt ||
    Date.now() - session.reauthenticatedAt.getTime() > 300_000
  )
    failure(
      403,
      "Confirme sua senha antes de alterar acesso administrativo.",
      "REAUTH_REQUIRED",
    );
}
export function version(actual: number, expected: number) {
  if (actual !== expected)
    failure(
      409,
      "Este registro mudou. Recarregue e confira antes de salvar.",
      "STALE_VERSION",
    );
}
export function reason(value: string) {
  const result = value.trim();
  if (result.length < 3 || result.length > 500)
    failure(400, "Informe um motivo de 3 a 500 caracteres.");
  return result;
}
export async function audit(
  tx: Tx,
  session: { userId: string; user: { name: string } },
  propertyId: string | null,
  kind: string,
  why: string,
  details: unknown,
  correlation: string = randomUUID(),
) {
  return tx.administrativeEvent.create({
    data: {
      propertyId,
      userId: session.userId,
      actorName: session.user.name,
      kind,
      reason: why,
      details: JSON.parse(JSON.stringify(details)) as Prisma.InputJsonValue,
      correlation,
    },
  });
}

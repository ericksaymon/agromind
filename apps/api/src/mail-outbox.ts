import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { db } from "./db";
import { settings } from "./config";
import { transporter } from "./mail";
import type { Tx } from "./stock-service";

type Envelope = { to: string; subject: string; text: string };
function key() {
  const raw = process.env.MAIL_ENCRYPTION_KEY || "";
  if (!/^[a-f0-9]{64}$/i.test(raw)) throw new Error("MAIL_KEY_UNAVAILABLE");
  return Buffer.from(raw, "hex");
}
export function encryptMail(value: Envelope) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const content = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), content]
    .map((x) => x.toString("base64"))
    .join(".");
}
export function decryptMail(value: string): Envelope {
  const [iv, tag, content] = value
    .split(".")
    .map((x) => Buffer.from(x, "base64"));
  const cipher = createDecipheriv("aes-256-gcm", key(), iv);
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(content), cipher.final()]).toString("utf8"),
  );
}
export async function queueMail(
  tx: Tx,
  intent: string,
  value: Envelope,
  invitationId?: string,
) {
  await tx.mailOutbox.create({
    data: { intent, invitationId, encrypted: encryptMail(value) },
  });
}
// A lease prevents concurrent workers from sending the same job. SMTP stays outside transactions.
export async function processOutbox(
  send = async (message: Envelope) => {
    await transporter.sendMail({ from: settings.smtpFrom, ...message });
  },
  jobId?: string,
) {
  const job = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string; attempts: number }[]
    >`SELECT id,attempts FROM "MailOutbox" WHERE (${jobId ?? null}::uuid IS NULL OR id=${jobId ?? null}::uuid) AND status IN ('QUEUED','TEMP_FAILURE') AND "nextAttemptAt"<=now() AND ("leaseUntil" IS NULL OR "leaseUntil"<now()) ORDER BY "createdAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!rows.length) return null;
    const exhausted = rows[0].attempts >= 5;
    const claimed = await tx.mailOutbox.update({
      where: { id: rows[0].id },
      data: {
        leaseUntil: new Date(Date.now() + 60_000),
        attempts: { increment: exhausted ? 0 : 1 },
      },
    });
    return { ...claimed, exhausted };
  });
  if (!job) return false;
  let message: Envelope;
  try {
    if (job.exhausted) throw new Error("MAIL_ATTEMPTS_EXHAUSTED");
    message = decryptMail(job.encrypted);
  } catch {
    await db.$transaction(async (tx) => {
      if (job.invitationId) {
        const invitation = await tx.invitation.findUnique({
          where: { id: job.invitationId },
        });
        if (invitation) {
          await tx.$queryRaw`SELECT id FROM "Property" WHERE id=${invitation.propertyId}::uuid FOR UPDATE`;
          await tx.invitation.updateMany({
            where: { id: invitation.id, status: "QUEUED" },
            data: { status: "REVOKED", version: { increment: 1 } },
          });
        }
      }
      await tx.mailOutbox.update({
        where: { id: job.id },
        data: { status: "FINAL_FAILURE", encrypted: "", leaseUntil: null },
      });
    });
    return true;
  }
  try {
    await send(message);
  } catch (error) {
    const permanent =
      Number((error as { responseCode?: number }).responseCode) >= 500;
    const final = permanent || job.attempts >= 5;
    await db.$transaction(async (tx) => {
      if (final && job.invitationId) {
        const i = await tx.invitation.findUnique({
          where: { id: job.invitationId },
        });
        if (i) {
          await tx.$queryRaw`SELECT id FROM "Property" WHERE id=${i.propertyId}::uuid FOR UPDATE`;
          await tx.invitation.updateMany({
            where: { id: i.id, status: "QUEUED" },
            data: { status: "REVOKED", version: { increment: 1 } },
          });
        }
      }
      await tx.mailOutbox.update({
        where: { id: job.id },
        data: {
          status: final ? "FINAL_FAILURE" : "TEMP_FAILURE",
          ...(final ? { encrypted: "" } : {}),
          leaseUntil: null,
          nextAttemptAt: new Date(
            Date.now() + Math.min(900_000, 30_000 * 2 ** (job.attempts - 1)),
          ),
        },
      });
    });
    return true;
  }
  await db.$transaction(async (tx) => {
    if (job.invitationId) {
      const initial = await tx.invitation.findUnique({
        where: { id: job.invitationId },
      });
      if (initial) {
        await tx.$queryRaw`SELECT id FROM "Property" WHERE id=${initial.propertyId}::uuid FOR UPDATE`;
        const invite = await tx.invitation.findUniqueOrThrow({
          where: { id: initial.id },
        });
        const issuer = await tx.membership.findUnique({
          where: {
            userId_propertyId: {
              userId: invite.issuerId,
              propertyId: invite.propertyId,
            },
          },
        });
        const predecessor = invite.predecessorId
          ? await tx.invitation.findUnique({
              where: { id: invite.predecessorId },
            })
          : null;
        if (
          invite.status === "QUEUED" &&
          issuer?.role === "ADMIN" &&
          (!predecessor || predecessor.status === "PENDING")
        ) {
          if (predecessor)
            await tx.invitation.update({
              where: { id: predecessor.id },
              data: { status: "REVOKED", version: { increment: 1 } },
            });
          await tx.invitation.update({
            where: { id: invite.id },
            data: {
              status: "PENDING",
              expiresAt: new Date(Date.now() + 7 * 86400_000),
              version: { increment: 1 },
            },
          });
        } else if (invite.status === "QUEUED")
          await tx.invitation.update({
            where: { id: invite.id },
            data: { status: "REVOKED", version: { increment: 1 } },
          });
      }
    }
    await tx.mailOutbox.update({
      where: { id: job.id },
      data: { status: "SMTP_ACCEPTED", encrypted: "", leaseUntil: null },
    });
  });
  return true;
}
export function startMailWorker() {
  let active: Promise<unknown> | null = null;
  const tick = () => {
    if (!active)
      active = processOutbox()
        .catch(() => undefined)
        .finally(() => {
          active = null;
        });
  };
  const timer = setInterval(tick, 2000);
  timer.unref();
  tick();
  return async () => {
    clearInterval(timer);
    await active;
  };
}

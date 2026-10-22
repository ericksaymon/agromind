import nodemailer from "nodemailer";
import { settings } from "./config";
import { db } from "./db";
import { digest, randomToken } from "./security";
import type { ActionKind } from "./generated/prisma/client";

export const transporter = nodemailer.createTransport({
  host: settings.smtpHost, port: settings.smtpPort, secure: settings.smtpPort === 465,
  connectionTimeout: 5000, socketTimeout: 8000,
  ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}),
});
export async function sendAction(user: { id: string; email: string }, kind: ActionKind) {
  const raw = randomToken();
  const minutes = kind === "RESET_PASSWORD" ? 30 : 1440;
  const route = kind === "RESET_PASSWORD" ? "redefinir-senha" : "confirmar-email";
  const subject = kind === "RESET_PASSWORD" ? "Redefina sua senha · AgroMind" : "Confirme seu e-mail · AgroMind";
  const action = kind === "RESET_PASSWORD" ? "definir uma nova senha" : "confirmar seu e-mail";
  const link = `${settings.origin}/${route}#token=${raw}`;
  const token = await db.$transaction(async tx => {
    await tx.actionToken.updateMany({ where: { userId: user.id, kind, usedAt: null }, data: { usedAt: new Date() } });
    return tx.actionToken.create({ data: { userId: user.id, kind, tokenHash: digest(raw), expiresAt: new Date(Date.now() + minutes * 60_000) } });
  });
  try {
    await transporter.sendMail({ from: settings.smtpFrom, to: user.email, subject,
      text: `AgroMind\n\nUse este link para ${action}:\n${link}\n\nVálido por ${minutes === 30 ? "30 minutos" : "24 horas"}. O link funciona uma única vez. Se você não solicitou esta ação, ignore esta mensagem.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;color:#18352b"><h1 style="color:#0b3d2e">AgroMind</h1><h2>${subject.split(" · ")[0]}</h2><p>Use o botão para ${action}.</p><a href="${link}" style="display:inline-block;background:#0b3d2e;color:white;padding:14px 22px;border-radius:6px;text-decoration:none">${kind === "RESET_PASSWORD" ? "Redefinir senha" : "Confirmar e-mail"}</a><p>Este link é de uso único e expira em ${minutes === 30 ? "30 minutos" : "24 horas"}.</p><p>Se você não solicitou esta ação, ignore esta mensagem.</p></div>`,
    });
  } catch {
    await db.actionToken.deleteMany({ where: { id: token.id } });
    throw new Error("MAIL_UNAVAILABLE");
  }
}

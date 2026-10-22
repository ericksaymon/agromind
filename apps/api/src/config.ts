import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url), quiet: true });

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Configuração obrigatória ausente: ${name}`);
  return value;
}
export const settings = {
  databaseUrl: required("DATABASE_URL"),
  origin: required("APP_ORIGIN"),
  csrfSecret: required("CSRF_SECRET"),
  production: process.env.APP_ENV === "production",
  port: Number(process.env.API_PORT || 4000),
  smtpHost: required("SMTP_HOST"),
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpFrom: required("SMTP_FROM"),
};
if (settings.csrfSecret.length < 32) throw new Error("CSRF_SECRET deve conter no mínimo 32 caracteres.");
if (settings.production && !settings.origin.startsWith("https://")) throw new Error("Produção exige HTTPS.");
if (settings.production && !process.env.SMTP_USER) throw new Error("Produção exige transporte SMTP autenticado.");

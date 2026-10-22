import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { AuthSession } from "../../../../packages/contracts/src/index";

export const getSession = cache(async (): Promise<AuthSession | null> => {
  const cookie = (await cookies()).toString();
  if (!cookie.includes("agromind_session=")) return null;
  const result = await fetch(`${process.env.API_INTERNAL_URL || "http://127.0.0.1:4000"}/api/auth/me`, { headers: { cookie }, cache: "no-store" });
  if (result.status === 401) return null;
  if (!result.ok) throw new Error("Não foi possível carregar sua sessão.");
  return result.json();
});
export async function requireAccount() {
  const session = await getSession();
  if (!session) redirect("/entrar");
  return session;
}
export async function requireProperty() {
  const session = await requireAccount();
  if (!session.user.emailVerified) redirect("/verificar-email");
  if (!session.property) redirect("/configuracao-inicial");
  return { ...session, property: session.property };
}
export async function redirectSignedIn() {
  const session = await getSession();
  if (session) redirect(!session.user.emailVerified ? "/verificar-email" : !session.property ? "/configuracao-inicial" : "/app");
}

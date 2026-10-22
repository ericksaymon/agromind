export class RequestError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
export async function apiRequest<T = { ok: boolean }>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      const csrf = await fetch("/api/auth/csrf", { cache: "no-store", credentials: "same-origin" });
      if (!csrf.ok) throw new Error("CSRF_UNAVAILABLE");
      headers["X-CSRF-Token"] = (await csrf.json()).token;
      headers["Content-Type"] = "application/json";
    }
    response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", cache: "no-store" });
  } catch { throw new RequestError("Não foi possível conectar. Confira sua conexão e tente novamente.", 0); }
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new RequestError(value.message || "Não foi possível concluir a solicitação.", response.status, value.code);
  return value;
}
export async function continueAfterLogin() {
  const session = await apiRequest<{ user: { emailVerified: boolean }; property: unknown }>("/api/auth/me");
  window.location.assign(!session.user.emailVerified ? "/verificar-email" : !session.property ? "/configuracao-inicial" : "/app");
}

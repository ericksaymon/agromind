"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiRequest, RequestError } from "@/lib/auth-client";
export function InvitationWorkspace() {
  async function changeAccount() {
    setBusy(true);
    try {
      await apiRequest("/api/auth/logout", {});
      window.location.assign("/entrar?returnTo=%2Fconvite");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const [token, setToken] = useState(""),
    [preview, setPreview] = useState<{
      propertyName: string;
      role: string;
      expiresAt: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [needLogin, setNeedLogin] = useState(false),
    [ready, setReady] = useState(false);
  const captured = useRef(false);
  async function inspect(raw: string) {
    setBusy(true);
    setError("");
    try {
      setPreview(await apiRequest("/api/invitations/preview", { token: raw }));
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof RequestError && [404, 410].includes(e.status)) {
        sessionStorage.removeItem("agromind.invitation");
        if (sessionStorage.getItem("agromind.returnTo") === "/convite")
          sessionStorage.removeItem("agromind.returnTo");
      }
    } finally {
      setBusy(false);
      setReady(true);
    }
  }
  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    const raw =
      new URLSearchParams(window.location.hash.slice(1)).get("token") ||
      sessionStorage.getItem("agromind.invitation") ||
      "";
    window.history.replaceState(null, "", window.location.pathname);
    if (/^[a-f0-9]{64}$/.test(raw)) {
      sessionStorage.setItem("agromind.invitation", raw);
      setToken(raw);
      void inspect(raw);
    } else {
      setError("Abra o link recebido por e-mail para conferir o convite.");
      setReady(true);
    }
  }, []);
  return (
    <main className="account-page settings-workspace">
      <section className="settings-card">
        <span className="eyebrow section-label">ACESSO À PROPRIEDADE</span>
        <h1>Seu convite para o AgroMind</h1>
        {!ready && <p role="status">Conferindo convite…</p>}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {token && !preview && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void inspect(token)}
          >
            Conferir convite novamente
          </button>
        )}
        {preview && (
          <>
            <h2>{preview.propertyName}</h2>
            <p>
              Papel:{" "}
              <strong>
                {{
                  ADMIN: "Administrador",
                  OPERATOR: "Operador",
                  VIEWER: "Consulta",
                }[preview.role] || preview.role}
              </strong>
            </p>
            <p>
              Válido até{" "}
              {new Date(preview.expiresAt).toLocaleString("pt-BR", {
                timeZone: "UTC",
              })}{" "}
              UTC. Entre com o mesmo e-mail que recebeu o convite e confirme seu
              endereço.
            </p>
            <button
              className="button button-green"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await apiRequest("/api/invitations/accept", { token });
                  sessionStorage.removeItem("agromind.invitation");
                  window.location.assign("/app");
                } catch (e) {
                  setError((e as Error).message);
                  if (e instanceof RequestError && e.status === 401)
                    setNeedLogin(true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Aceitar acesso à propriedade
            </button>
            <p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void changeAccount()}
              >
                {needLogin ? "Entrar para continuar" : "Entrar com outra conta"}
              </button>{" "}
              ·{" "}
              <Link href="/criar-conta?returnTo=%2Fconvite">
                Criar conta para aceitar
              </Link>
            </p>
          </>
        )}
        <p>
          <Link href="/verificar-email">Confirmar meu e-mail</Link>
        </p>
        <p>
          <Link href="/conta">Minha conta</Link> ·{" "}
          <Link href="/">Voltar ao início</Link>
        </p>
        <p className="settings-help">
          Abrir este link não cria conta, propriedade ou acesso automaticamente.
        </p>
      </section>
    </main>
  );
}

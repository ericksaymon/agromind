"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  administrativeLabels,
  AdministrativeEventDetail,
} from "./administrative-event";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { apiRequest, RequestError } from "@/lib/auth-client";
type Account = {
  id: string;
  name: string;
  email: string;
  version: number;
  localMail: boolean;
  change: null | {
    newEmail: string;
    expiresAt: string;
    oldConfirmedAt: string | null;
    newConfirmedAt: string | null;
  };
  memberships: {
    userId: string;
    propertyId: string;
    role: string;
    version: number;
    property: { name: string };
  }[];
};
type Session = {
  id: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
};
const data = (form: HTMLFormElement) =>
  Object.fromEntries(new FormData(form)) as Record<string, string>;
export function AccountWorkspace() {
  const { setDirty } = useUnsavedChanges();
  const [account, setAccount] = useState<Account | null>(null),
    [sessions, setSessions] = useState<Session[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [token, setToken] = useState("");
  const [activity, setActivity] = useState<
      {
        id: string;
        kind: string;
        createdAt: string;
        details: Record<string, unknown>;
      }[]
    >([]),
    [activityPage, setActivityPage] = useState(1),
    [activityTotal, setActivityTotal] = useState(0);
  const [page, setPage] = useState(1),
    [total, setTotal] = useState(0);
  const seq = useRef(0),
    pendingIntent = useRef<{ signature: string; key: string } | null>(null);
  const reload = useCallback(async () => {
    const id = ++seq.current;
    try {
      const [a, s, events] = await Promise.all([
        apiRequest<Account>("/api/account"),
        apiRequest<{ rows: Session[]; total: number }>(
          `/api/account/sessions?page=${page}`,
        ),
        apiRequest<{ rows: typeof activity; total: number }>(
          `/api/account/audit?page=${activityPage}`,
        ),
      ]);
      if (id === seq.current) {
        setError("");
        setAccount(a);
        setSessions(s.rows);
        setTotal(s.total);
        setActivity(events.rows);
        setActivityTotal(events.total);
      }
    } catch (e) {
      if (id === seq.current) {
        setError((e as Error).message);
        if (e instanceof RequestError && e.status === 401) {
          setAccount(null);
          setSessions([]);
        }
      }
    }
  }, [page, activityPage]);
  useEffect(() => {
    const capture = () => {
      const raw =
        new URLSearchParams(window.location.hash.slice(1)).get("emailToken") ||
        sessionStorage.getItem("agromind.emailToken");
      if (raw) {
        sessionStorage.setItem("agromind.emailToken", raw);
        setToken(raw);
        window.history.replaceState(null, "", window.location.pathname);
      }
    };
    capture();
    window.addEventListener("hashchange", capture);
    return () => window.removeEventListener("hashchange", capture);
  }, []);
  useEffect(() => {
    void reload();
    return () => {
      seq.current++;
    };
  }, [reload]);
  async function act(
    path: string,
    body: unknown,
    message: string,
    form?: HTMLFormElement,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (path === "/api/account/profile" || path === "/api/account/email") {
        const bytes = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(path + JSON.stringify(body)),
        );
        const signature = Array.from(new Uint8Array(bytes), (x) =>
          x.toString(16).padStart(2, "0"),
        ).join("");
        if (pendingIntent.current?.signature !== signature)
          pendingIntent.current = { signature, key: crypto.randomUUID() };
        body = { ...(body as object), key: pendingIntent.current.key };
      }
      const r = await apiRequest<{ loginRequired?: boolean }>(path, body);
      pendingIntent.current = null;
      setDirty(false);
      if (path === "/api/account/email/confirm") {
        sessionStorage.removeItem("agromind.emailToken");
        setToken("");
      }
      if (r.loginRequired) {
        sessionStorage.removeItem("agromind.emailToken");
        window.location.assign("/entrar");
        return;
      }
      form?.reset();
      setNotice(message);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main
      className="account-page settings-workspace"
      onChange={() => setDirty(true)}
    >
      <header className="stock-page-heading">
        <div>
          <span className="eyebrow section-label">SEU ACESSO</span>
          <h1>Minha conta</h1>
          <p>Seus dados pessoais valem para todas as propriedades.</p>
        </div>
        <Link
          href={account?.memberships.length ? "/app" : "/configuracao-inicial"}
        >
          Voltar ao AgroMind ↗
        </Link>
      </header>
      {error && (
        <p className="form-error" role="alert">
          {error}{" "}
          <Link href="/entrar?returnTo=%2Fconta">Entrar para continuar</Link>{" "}
          <button onClick={() => void reload()} disabled={busy}>
            Recarregar
          </button>
        </p>
      )}
      {notice && (
        <p className="settings-notice" role="status">
          {notice}
        </p>
      )}
      {!account && !error && <p role="status">Carregando sua conta…</p>}
      {account && (
        <>
          <section className="settings-card">
            <h2>Seu nome</h2>
            <p>
              Novas ações usarão o nome atualizado. A autoria histórica será
              preservada.
            </p>
            <form
              className="settings-form"
              key={account.version}
              onSubmit={(e) => {
                e.preventDefault();
                void act(
                  "/api/account/profile",
                  {
                    name: data(e.currentTarget).name,
                    version: account.version,
                  },
                  "Nome atualizado.",
                );
              }}
            >
              <label>
                Nome
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="name"
                  defaultValue={account.name}
                />
              </label>
              <button disabled={busy} className="button button-green">
                Salvar nome
              </button>
            </form>
          </section>
          <section className="settings-card">
            <h2>E-mail da conta</h2>
            <p>
              Endereço atual: <strong>{account.email}</strong>. A troca exige
              confirmar os dois endereços, em até 30 minutos. Ao concluir, todas
              as sessões serão encerradas.
            </p>
            {account.localMail && (
              <p className="settings-help">
                Ambiente local: mensagens capturadas no Mailpit, em
                localhost:18025. Não há entrega externa.
              </p>
            )}
            {token && (
              <div className="refinement-panel">
                <p>
                  Você abriu uma confirmação de endereço. Confirme usando a
                  sessão da conta original.
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(
                      "/api/account/email/confirm",
                      { token },
                      "Endereço confirmado. Ainda é necessário confirmar o outro e-mail.",
                    )
                  }
                >
                  Confirmar este endereço
                </button>
                <button disabled={busy} onClick={() => setToken("")}>
                  Fechar confirmação
                </button>
              </div>
            )}
            {account.change && (
              <div className="refinement-panel">
                <p>
                  Troca pendente para <strong>{account.change.newEmail}</strong>
                  .
                </p>
                <p>
                  Antigo:{" "}
                  {account.change.oldConfirmedAt ? "confirmado" : "aguardando"}{" "}
                  · Novo:{" "}
                  {account.change.newConfirmedAt ? "confirmado" : "aguardando"}
                </p>
                <p>
                  Expira em{" "}
                  {new Date(account.change.expiresAt).toLocaleString("pt-BR")}.
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(
                      "/api/account/email/cancel",
                      {},
                      "Troca cancelada. Seu e-mail atual foi mantido.",
                    )
                  }
                >
                  Cancelar alteração de e-mail
                </button>
              </div>
            )}
            <form
              className="settings-form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  b = data(form);
                form.querySelector<HTMLInputElement>(
                  'input[type="password"]',
                )!.value = "";
                void act(
                  "/api/account/email",
                  {
                    email: b.email,
                    currentPassword: b.currentPassword,
                    version: account.version,
                  },
                  "Confirmações colocadas na fila de e-mail.",
                  form,
                );
              }}
            >
              <label>
                Novo e-mail
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                />
              </label>
              <label>
                Senha atual
                <input
                  name="currentPassword"
                  type="password"
                  required
                  maxLength={128}
                  autoComplete="current-password"
                />
              </label>
              <button disabled={busy} className="button button-green">
                Solicitar alteração de e-mail
              </button>
            </form>
          </section>
          <section className="settings-card">
            <h2>Alterar senha</h2>
            <p>
              Use de 8 a 128 caracteres, com letras e números. Todas as sessões,
              inclusive esta, serão encerradas.
            </p>
            <form
              className="settings-form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  b = data(form);
                if (b.password !== b.confirmation) {
                  setError("As novas senhas precisam ser iguais.");
                  return;
                }
                if (
                  !window.confirm(
                    "Salvar a nova senha e encerrar todas as sessões?",
                  )
                )
                  return;
                form.reset();
                void act(
                  "/api/account/password",
                  { currentPassword: b.currentPassword, password: b.password },
                  "Senha alterada.",
                );
              }}
            >
              <label>
                Senha atual
                <input
                  name="currentPassword"
                  type="password"
                  required
                  maxLength={128}
                  autoComplete="current-password"
                />
              </label>
              <label>
                Nova senha
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
              <label>
                Confirme a nova senha
                <input
                  name="confirmation"
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
              <button disabled={busy} className="button button-green">
                Salvar nova senha e sair
              </button>
            </form>
          </section>
          <section className="settings-card">
            <h2>Sessões de acesso</h2>
            <p>
              Exibimos as datas registradas, sem estimar dispositivo ou
              localização.
            </p>
            <button
              disabled={busy}
              onClick={() =>
                void act(
                  "/api/account/sessions/revoke",
                  { id: "others" },
                  "Outras sessões encerradas.",
                )
              }
            >
              Encerrar todas as outras sessões
            </button>
            <ul className="settings-list">
              {sessions.map((s) => (
                <li key={s.id}>
                  <div>
                    <strong>
                      {s.current ? "Esta sessão" : "Outra sessão"}
                    </strong>
                    <small>
                      Criada em {new Date(s.createdAt).toLocaleString("pt-BR")}{" "}
                      · expira em{" "}
                      {new Date(s.expiresAt).toLocaleString("pt-BR")}
                    </small>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (
                        s.current &&
                        !window.confirm(
                          "Encerrar esta sessão e voltar para entrar?",
                        )
                      )
                        return;
                      void act(
                        "/api/account/sessions/revoke",
                        { id: s.id },
                        "Sessão encerrada.",
                      );
                    }}
                  >
                    Encerrar sessão
                  </button>
                </li>
              ))}
            </ul>
            <div className="settings-pagination">
              <button
                disabled={busy || page === 1}
                onClick={() => setPage(page - 1)}
              >
                Sessões anteriores
              </button>
              <span>
                Página {page} · {total} sessões
              </span>
              <button
                disabled={busy || page * 20 >= total}
                onClick={() => setPage(page + 1)}
              >
                Mais sessões
              </button>
            </div>
          </section>
          <section className="settings-card">
            <h2>Suas propriedades</h2>
            <p>
              Você pode sair da equipe sem apagar sua conta ou o histórico
              compartilhado. O último administrador deve nomear outro antes de
              sair.
            </p>
            <Link href="/nova-propriedade">Criar outra propriedade ↗</Link>
            <ul className="settings-list">
              {account.memberships.map((m) => (
                <li key={m.propertyId}>
                  <div>
                    <strong>{m.property.name}</strong>
                    <small>{m.role}</small>
                  </div>
                  <form
                    className="settings-inline"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = e.currentTarget,
                        b = data(form);
                      if (
                        !window.confirm(
                          `Sair da propriedade ${m.property.name}? Você perderá o acesso imediatamente.`,
                        )
                      )
                        return;
                      if (m.role === "ADMIN") {
                        setBusy(true);
                        form.reset();
                        try {
                          await apiRequest("/api/account/reauthenticate", {
                            password: b.password,
                          });
                        } catch (e) {
                          setError((e as Error).message);
                          setBusy(false);
                          return;
                        }
                      }
                      void act(
                        `/api/properties/${m.propertyId}/members/${account.id}`,
                        {
                          key: crypto.randomUUID(),
                          reason: b.reason,
                          version: m.version,
                          role: "REMOVE",
                        },
                        "Você saiu da propriedade.",
                      );
                    }}
                  >
                    <label>
                      Motivo
                      <input
                        name="reason"
                        required
                        minLength={3}
                        maxLength={500}
                      />
                    </label>
                    {m.role === "ADMIN" && (
                      <label>
                        Senha atual
                        <input
                          type="password"
                          name="password"
                          required
                          maxLength={128}
                          autoComplete="current-password"
                        />
                      </label>
                    )}
                    <button disabled={busy}>Sair da propriedade</button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
          <section className="settings-card">
            <h2>Atividade da sua conta</h2>
            <p>
              Este histórico pessoal não é disponibilizado aos administradores
              das propriedades.
            </p>
            {!activity.length && <p>Nenhuma alteração pessoal registrada.</p>}
            <ol className="settings-list">
              {activity.map((event) => (
                <li key={event.id}>
                  <div>
                    <strong>
                      {administrativeLabels[event.kind] || "Alteração da conta"}
                    </strong>
                    <small>
                      {new Date(event.createdAt).toLocaleString("pt-BR")}
                    </small>
                    <AdministrativeEventDetail details={event.details} />
                  </div>
                </li>
              ))}
            </ol>
            <div className="settings-pagination">
              <button
                disabled={busy || activityPage === 1}
                onClick={() => setActivityPage(activityPage - 1)}
              >
                Atividade anterior
              </button>
              <span>
                Página {activityPage} · {activityTotal} registros
              </span>
              <button
                disabled={busy || activityPage * 20 >= activityTotal}
                onClick={() => setActivityPage(activityPage + 1)}
              >
                Mais atividade
              </button>
            </div>
          </section>
          <footer>
            <Link href="/termos">Termos de uso</Link> ·{" "}
            <Link href="/privacidade">Privacidade</Link>
          </footer>
        </>
      )}
    </main>
  );
}

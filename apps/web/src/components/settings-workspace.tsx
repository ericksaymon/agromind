"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  administrativeLabels,
  AdministrativeEventDetail,
} from "./administrative-event";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { useRouter } from "next/navigation";
import { apiRequest, RequestError } from "@/lib/auth-client";
import type { PropertySummary } from "../../../../packages/contracts/src/index";

type Category = {
  id: string;
  name: string;
  version: number;
  archived: boolean;
};
type Member = {
  userId: string;
  role: string;
  version: number;
  user: { name: string; email: string };
};
type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  version: number;
  delivery?: { status: string; attempts: number };
};
type Event = {
  details: Record<string, unknown>;
  id: string;
  actorName: string;
  kind: string;
  reason: string;
  createdAt: string;
};
const labels: Record<string, string> = {
  ADMIN: "Administrador",
  OPERATOR: "Operador",
  VIEWER: "Consulta",
  QUEUED: "Na fila",
  PENDING: "Pendente",
  ACCEPTED: "Aceito",
  REVOKED: "Revogado",
  EXPIRED: "Expirado",
  SMTP_ACCEPTED: "Aceito pelo SMTP",
  TEMP_FAILURE: "Falha temporária",
  FINAL_FAILURE: "Falha final",
};
const key = () => crypto.randomUUID();
function fields(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form)) as Record<string, string>;
}
function IntentReason() {
  return (
    <label>
      Motivo
      <textarea
        name="reason"
        required
        minLength={3}
        maxLength={500}
        placeholder="Explique esta alteração"
      />
    </label>
  );
}
export function SettingsWorkspace({
  property,
  userId,
}: {
  property: PropertySummary;
  userId: string;
}) {
  const router = useRouter(),
    pendingIntent = useRef<{ signature: string; key: string } | null>(null);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("property"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [details, setDetails] = useState<
      (PropertySummary & { settingsVersion: number }) | null
    >(null),
    [categories, setCategories] = useState<Category[]>([]),
    [members, setMembers] = useState<Member[]>([]),
    [invitations, setInvitations] = useState<Invitation[]>([]),
    [events, setEvents] = useState<Event[]>([]);
  const [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [ready, setReady] = useState(false);
  const seq = useRef(0),
    { dirty, setDirty } = useUnsavedChanges(),
    base = `/api/properties/${property.id}`,
    admin = property.role === "ADMIN";
  const reload = useCallback(async () => {
    const id = ++seq.current;
    setError("");
    setReady(false);
    try {
      const d = await apiRequest<PropertySummary & { settingsVersion: number }>(
        base,
      );
      let cats: { rows: Category[]; total: number } = { rows: [], total: 0 },
        team: { rows: Member[]; total: number } | null = null,
        inv: { rows: Invitation[]; total: number } | null = null,
        hist: { rows: Event[]; total: number } | null = null;
      if (tab === "categories")
        cats = await apiRequest(
          base + `/categories?page=${page}&q=${encodeURIComponent(q)}`,
        );
      if (admin && tab === "team") {
        team = await apiRequest(
          base + `/members?page=${page}&q=${encodeURIComponent(q)}`,
        );
        inv = await apiRequest(
          base + `/invitations?page=${page}&q=${encodeURIComponent(q)}`,
        );
      }
      if (admin && tab === "audit")
        hist = await apiRequest(
          base + `/audit?page=${page}&q=${encodeURIComponent(q)}`,
        );
      if (id !== seq.current) return;
      setDetails(d);
      setCategories(cats.rows);
      setMembers(team?.rows || []);
      setInvitations(inv?.rows || []);
      setEvents(hist?.rows || []);
      setTotal(
        tab === "categories"
          ? cats.total
          : (hist?.total ?? Math.max(team?.total ?? 0, inv?.total ?? 0)),
      );
      setReady(true);
    } catch (e) {
      if (id === seq.current) {
        setError((e as Error).message);
        if (e instanceof RequestError && [401, 403, 404].includes(e.status)) {
          setDetails(null);
          setMembers([]);
          setInvitations([]);
          setEvents([]);
        }
      }
    }
  }, [base, tab, admin, page, q]);
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
    if (body && typeof body === "object" && "key" in body) {
      const signature = path + JSON.stringify({ ...body, key: undefined });
      if (pendingIntent.current?.signature !== signature)
        pendingIntent.current = { signature, key: String(body.key) };
      body = { ...body, key: pendingIntent.current.key };
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(base + path, body);
      pendingIntent.current = null;
      setDirty(false);
      form?.reset();
      setNotice(message);
      await reload();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof RequestError && [401, 403, 404].includes(e.status)) {
        setDetails(null);
        setMembers([]);
        setInvitations([]);
        setEvents([]);
        setReady(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="settings-workspace"
      onChange={(e) => {
        if ((e.target as HTMLInputElement).name !== "list-search")
          setDirty(true);
      }}
    >
      <div className="stock-page-heading">
        <div>
          <span className="eyebrow section-label">ADMINISTRAÇÃO</span>
          <h1>Configurações</h1>
          <p>
            {property.name} · {labels[property.role]}
          </p>
        </div>
        <Link href="/conta">Minha conta e sessões ↗</Link>
      </div>
      <nav className="settings-tabs" aria-label="Seções de configurações">
        {[
          ["property", "Propriedade"],
          ["team", "Equipe e convites"],
          ["categories", "Categorias"],
          ["audit", "Histórico administrativo"],
        ]
          .filter(([id]) => admin || id === "property" || id === "categories")
          .map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? "page" : undefined}
              onClick={() => {
                if (
                  dirty &&
                  !window.confirm("Descartar alterações não salvas?")
                )
                  return;
                setDirty(false);
                setTab(id);
                setPage(1);
                setQ("");
                setNotice("");
              }}
            >
              {label}
            </button>
          ))}
      </nav>
      {tab !== "property" && (
        <form
          className="settings-inline settings-search"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              dirty &&
              !window.confirm("Descartar edições e filtrar a lista?")
            )
              return;
            setDirty(false);
            setQ(fields(e.currentTarget)["list-search"]);
            setPage(1);
          }}
        >
          <label>
            Buscar nesta lista
            <input
              key={tab}
              name="list-search"
              maxLength={120}
              placeholder={
                tab === "team"
                  ? "Nome ou e-mail"
                  : tab === "categories"
                    ? "Nome da categoria"
                    : "Autor, alteração ou motivo"
              }
            />
          </label>
          <button disabled={busy}>Filtrar</button>
        </form>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}{" "}
          <button onClick={() => void reload()} disabled={busy}>
            Recarregar dados
          </button>
        </p>
      )}
      {notice && (
        <p role="status" className="settings-notice">
          {notice}
        </p>
      )}
      {!ready && !error && <p role="status">Carregando configurações…</p>}
      {ready && tab === "property" && details && (
        <section className="settings-card">
          <h2>Dados da propriedade</h2>
          {admin ? (
            <form
              key={`${property.id}:${details.settingsVersion}`}
              className="settings-form"
              onChange={() => setDirty(true)}
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  b = fields(form),
                  changed = b.timezone !== details.timezone;
                if (
                  changed &&
                  !window.confirm(
                    `Alterar de ${details.timezone} para ${b.timezone}? As datas dos fatos serão preservadas. A cobertura será removida e precisará ser declarada novamente; médias e autonomia podem ficar indisponíveis.`,
                  )
                )
                  return;
                void act(
                  "/settings",
                  {
                    ...b,
                    key: key(),
                    version: details.settingsVersion,
                    confirmTimezone: changed,
                  },
                  "Propriedade atualizada.",
                );
              }}
            >
              <label>
                Nome da propriedade
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={120}
                  defaultValue={details.name}
                />
              </label>
              <label>
                Responsável
                <input
                  name="responsible"
                  required
                  minLength={2}
                  maxLength={120}
                  defaultValue={details.responsible}
                />
              </label>
              <label>
                Telefone de contato
                <input
                  name="phone"
                  maxLength={30}
                  defaultValue={details.phone || ""}
                />
                <small>Este contato não conecta o WhatsApp.</small>
              </label>
              <label>
                Fuso horário IANA
                <input
                  name="timezone"
                  required
                  maxLength={80}
                  defaultValue={details.timezone}
                  list="settings-timezones"
                />
                <datalist id="settings-timezones">
                  {[
                    "America/Cuiaba",
                    "America/Porto_Velho",
                    "America/Sao_Paulo",
                    "America/Manaus",
                    "America/Rio_Branco",
                  ].map((x) => (
                    <option key={x} value={x} />
                  ))}
                </datalist>
              </label>
              <IntentReason />
              <button className="button button-green" disabled={busy}>
                Salvar propriedade
              </button>
            </form>
          ) : (
            <dl>
              <dt>Responsável</dt>
              <dd>{details.responsible}</dd>
              <dt>Fuso horário</dt>
              <dd>{details.timezone}</dd>
              <dt>Telefone</dt>
              <dd>{details.phone || "Não informado"}</dd>
            </dl>
          )}
          <p className="settings-help">
            O método inicial (
            {details.startMethod === "IMPORT" ? "planilha" : "cadastro manual"})
            é preservado. Para sair desta equipe, acesse sua conta.
          </p>
          <Link href="/nova-propriedade">Criar outra propriedade ↗</Link>
        </section>
      )}
      {ready && tab === "categories" && (
        <section className="settings-card">
          <h2>Catálogo de categorias</h2>
          <p>
            Renomear preserva a identidade e o histórico. Arquivar impede novas
            associações e mantém os produtos existentes.
          </p>
          {admin && (
            <form
              className="settings-form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  b = fields(form);
                void act(
                  "/categories",
                  { ...b, key: key() },
                  "Categoria criada.",
                  form,
                );
              }}
            >
              <label>
                Nova categoria
                <input name="name" required minLength={2} maxLength={80} />
              </label>
              <IntentReason />
              <button disabled={busy} className="button button-green">
                Criar categoria
              </button>
            </form>
          )}
          {!categories.length && (
            <p>
              Catálogo vazio. Peça ao administrador para criar uma categoria.
            </p>
          )}
          <ul className="settings-list">
            {categories.map((c) => (
              <li key={c.id}>
                {admin ? (
                  <form
                    className="settings-inline"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const b = fields(e.currentTarget);
                      if (
                        !window.confirm(
                          `Confirmar alteração da categoria ${c.name}?`,
                        )
                      )
                        return;
                      void act(
                        `/categories/${c.id}`,
                        {
                          key: key(),
                          name: b.name,
                          reason: b.reason,
                          version: c.version,
                          archived: b.archived === "true",
                        },
                        "Categoria atualizada.",
                      );
                    }}
                  >
                    <label>
                      Nome
                      <input
                        aria-label={`Nome da categoria ${c.name}`}
                        name="name"
                        defaultValue={c.name}
                        required
                        minLength={2}
                        maxLength={80}
                      />
                    </label>
                    <label>
                      Situação
                      <select name="archived" defaultValue={String(c.archived)}>
                        <option value="false">Ativa</option>
                        <option value="true">Arquivada</option>
                      </select>
                    </label>
                    <label>
                      Motivo
                      <input
                        name="reason"
                        required
                        minLength={3}
                        maxLength={500}
                      />
                    </label>
                    <button disabled={busy}>Salvar categoria</button>
                  </form>
                ) : (
                  <>
                    <strong>{c.name}</strong>
                    <span>{c.archived ? "Arquivada" : "Ativa"}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {ready && tab === "team" && admin && (
        <>
          <section className="settings-card">
            <h2>Confirmação de identidade</h2>
            <p>
              Promover ou remover administradores exige confirmar sua senha. A
              autorização vale por cinco minutos nesta sessão.
            </p>
            <form
              className="settings-inline"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  password = fields(form).password;
                setBusy(true);
                setError("");
                form.reset();
                try {
                  await apiRequest("/api/account/reauthenticate", { password });
                  setDirty(false);
                  setNotice("Identidade confirmada por cinco minutos.");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Senha atual
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                />
              </label>
              <button disabled={busy}>Confirmar identidade</button>
            </form>
          </section>
          <section className="settings-card">
            <h2>Convidar para {property.name}</h2>
            <p>
              Os e-mails deste ambiente são capturados no Mailpit local. Aceite
              do SMTP não comprova entrega na caixa de entrada.
            </p>
            <form
              className="settings-form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  b = fields(form);
                if (
                  !window.confirm(
                    `Convidar ${b.email} com acesso ${labels[b.role]} para ${property.name}?`,
                  )
                )
                  return;
                void act(
                  "/invitations",
                  { ...b, key: key() },
                  "Convite colocado na fila de envio.",
                  form,
                );
              }}
            >
              <label>
                E-mail
                <input name="email" type="email" required maxLength={254} />
              </label>
              <label>
                Papel
                <select name="role" defaultValue="OPERATOR">
                  <option value="OPERATOR">
                    Operador — estoque e importação
                  </option>
                  <option value="VIEWER">Consulta — leitura e simulação</option>
                  <option value="ADMIN">
                    Administrador — controle da equipe e propriedade
                  </option>
                </select>
              </label>
              <IntentReason />
              <button disabled={busy} className="button button-green">
                Enviar convite
              </button>
            </form>
          </section>
          <section className="settings-card">
            <h2>Equipe</h2>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  dirty &&
                  !window.confirm("Descartar alterações e atualizar a lista?")
                )
                  return;
                setDirty(false);
                void reload();
              }}
            >
              Atualizar equipe e convites
            </button>
            <ul className="settings-list">
              {members.map((m) => (
                <li key={m.userId}>
                  <div>
                    <strong>
                      {m.user.name}
                      {m.userId === userId ? " (você)" : ""}
                    </strong>
                    <small>{m.user.email}</small>
                  </div>
                  <form
                    className="settings-inline"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const b = fields(e.currentTarget);
                      if (
                        !window.confirm(
                          `Confirmar ${b.role === "REMOVE" ? "remoção de" : `mudança para ${labels[b.role]} de`} ${m.user.name}? O acesso será atualizado imediatamente. O último administrador não pode sair.`,
                        )
                      )
                        return;
                      void act(
                        `/members/${m.userId}`,
                        { ...b, key: key(), version: m.version },
                        "Acesso atualizado.",
                      );
                    }}
                  >
                    <label>
                      Papel
                      <select name="role" defaultValue={m.role}>
                        <option value="ADMIN">Administrador</option>
                        <option value="OPERATOR">Operador</option>
                        <option value="VIEWER">Consulta</option>
                        <option value="REMOVE">Remover da propriedade</option>
                      </select>
                    </label>
                    <label>
                      Motivo
                      <input
                        name="reason"
                        required
                        minLength={3}
                        maxLength={500}
                      />
                    </label>
                    <button disabled={busy}>Atualizar acesso</button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
          <section className="settings-card">
            <h2>Convites</h2>
            {!invitations.length && <p>Nenhum convite emitido.</p>}
            <ul className="settings-list">
              {invitations.map((i) => (
                <li key={i.id}>
                  <div>
                    <strong>{i.email}</strong>
                    <small>
                      {labels[i.role]} · {labels[i.status] || i.status} · envio:{" "}
                      {labels[i.delivery?.status || ""] || "Na fila"}
                    </small>
                  </div>
                  {i.status !== "ACCEPTED" && (
                    <form
                      className="settings-inline"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const b = fields(e.currentTarget);
                        void act(
                          `/invitations/${i.id}`,
                          { ...b, key: key(), version: i.version },
                          "Solicitação registrada.",
                        );
                      }}
                    >
                      <label>
                        Ação
                        <select name="action">
                          <option value="REVOKE">Revogar</option>
                          <option value="RESEND">Reenviar</option>
                        </select>
                      </label>
                      <label>
                        Motivo
                        <input
                          name="reason"
                          required
                          minLength={3}
                          maxLength={500}
                        />
                      </label>
                      <button disabled={busy}>Confirmar ação</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      {ready && tab === "audit" && (
        <section className="settings-card">
          <h2>Histórico administrativo</h2>
          <p>
            Registros de configurações, acessos e categorias. Datas em{" "}
            {property.timezone}. Os movimentos de estoque têm histórico próprio.
          </p>
          {!events.length && (
            <p>Nenhuma alteração administrativa registrada.</p>
          )}
          <ol className="settings-list">
            {events.map((e) => (
              <li key={e.id}>
                <div>
                  <strong>
                    {administrativeLabels[e.kind] || "Alteração administrativa"}
                  </strong>
                  <small>
                    {e.actorName} ·{" "}
                    {new Date(e.createdAt).toLocaleString("pt-BR", {
                      timeZone: property.timezone,
                    })}
                  </small>
                  <p>{e.reason}</p>
                  <details>
                    <summary>Ver alteração</summary>
                    <AdministrativeEventDetail details={e.details} />
                  </details>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      {ready && (tab === "team" || tab === "audit" || tab === "categories") && (
        <div className="settings-pagination">
          <button
            disabled={busy || page === 1}
            onClick={() => setPage(page - 1)}
          >
            Anterior
          </button>
          <span>
            Página {page} · {total} registros
          </span>
          <button
            disabled={busy || page * 20 >= total}
            onClick={() => setPage(page + 1)}
          >
            Próxima
          </button>
        </div>
      )}
    </div>
  );
}

export function NewPropertyForm({ name }: { name: string }) {
  const { setDirty } = useUnsavedChanges();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const intent = useRef("");
  return (
    <section className="settings-card">
      <h1>Criar outra propriedade</h1>
      <p>
        Ela terá estoque e equipe independentes. Você será seu administrador.
      </p>
      <form
        className="settings-form"
        onChange={() => setDirty(true)}
        onSubmit={async (e) => {
          e.preventDefault();
          const b = fields(e.currentTarget);
          if (!window.confirm(`Criar a propriedade ${b.name}?`)) return;
          setBusy(true);
          setError("");
          if (!intent.current) intent.current = key();
          try {
            await apiRequest("/api/account/properties", {
              ...b,
              key: intent.current,
              reason: "Criação explícita pelo titular",
              startMethod: "MANUAL",
            });
            setDirty(false);
            window.location.assign("/app/estoque");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Nome da propriedade
          <input
            name="name"
            required
            minLength={2}
            maxLength={120}
            onChange={() => {
              intent.current = "";
            }}
          />
        </label>
        <label>
          Responsável
          <input
            name="responsible"
            required
            minLength={2}
            maxLength={120}
            defaultValue={name}
            onChange={() => {
              intent.current = "";
            }}
          />
        </label>
        <label>
          Fuso horário
          <input
            name="timezone"
            required
            defaultValue="America/Cuiaba"
            maxLength={80}
            onChange={() => {
              intent.current = "";
            }}
          />
        </label>
        <label>
          Telefone opcional
          <input
            name="phone"
            maxLength={30}
            onChange={() => {
              intent.current = "";
            }}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="button button-green" disabled={busy}>
          Criar propriedade
        </button>
        <Link href="/conta">Voltar à conta</Link>
      </form>
    </section>
  );
}

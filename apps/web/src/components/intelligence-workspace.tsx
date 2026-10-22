"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  Clock3,
  FlaskConical,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { apiRequest } from "@/lib/auth-client";
import { AnalysisDialog } from "@/components/analysis-workspace";
import {
  defaultIntelligencePolicy,
  type AnalysisPolicy,
  type AnalysisView,
  type IntelligencePolicy,
  type IntelligenceProduct,
  type IntelligenceResult,
  type IntelligenceView,
  type PropertySummary,
  type SimulationView,
} from "../../../../packages/contracts/src/index";

const n = (v: string | number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(
    Number(v),
  );
const money = (v: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(v),
  );
const unitMoney = (v: string) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(v));
const date = (v: string) => v.slice(0, 10).split("-").reverse().join("/");
const shift = (day: string, days: number) =>
  new Date(Date.parse(day + "T00:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
const tabs = [
  { id: "consumption", title: "Consumo" },
  { id: "finance", title: "Finanças" },
  { id: "excess", title: "Excesso e capital parado" },
  { id: "planning", title: "Planejamento e simulação" },
] as const;
type Tab = (typeof tabs)[number]["id"];
type Filters = {
  from: string;
  to: string;
  productId: string;
  category: string;
  grouping: "DAY" | "WEEK" | "MONTH";
  horizonDays: number;
};
const initialFilters: Filters = {
  from: "",
  to: "",
  productId: "",
  category: "",
  grouping: "DAY",
  horizonDays: 30,
};
const comparison: Record<string, string> = {
  INSUFFICIENT: "Cobertura insuficiente",
  STARTED: "Início de consumo",
  NO_CONSUMPTION: "Sem consumo nos períodos",
  COMPARABLE: "Períodos comparáveis",
};
function ErrorNotice({ text }: { text: string }) {
  return text ? (
    <p className="stock-error" role="alert">
      {text}
    </p>
  ) : null;
}
function Metric({
  title,
  value,
  note,
}: {
  title: string;
  value: string;
  note: string;
}) {
  return (
    <section className="analysis-stat">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </section>
  );
}
function Table({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="stock-table-scroll"
      role="region"
      tabIndex={0}
      aria-label={title}
    >
      {children}
    </div>
  );
}
function Pager({
  page,
  total,
  change,
  label,
}: {
  page: number;
  total: number;
  change: (p: number) => void;
  label: string;
}) {
  if (total <= 20) return null;
  return (
    <nav className="intel-pagination" aria-label={label}>
      <button
        className="stock-secondary"
        disabled={page <= 1}
        onClick={() => change(page - 1)}
      >
        Anterior
      </button>
      <span>
        Página {page} de {Math.ceil(total / 20)} · {total} registros
      </span>
      <button
        className="stock-secondary"
        disabled={page * 20 >= total}
        onClick={() => change(page + 1)}
      >
        Próxima
      </button>
    </nav>
  );
}
function ProductLink({ p }: { p: IntelligenceProduct }) {
  return (
    <Link className="intel-product-link" href={`/app/estoque/${p.id}`}>
      {p.name}
      <ArrowUpRight size={13} />
      {p.archived && <small>Arquivado</small>}
    </Link>
  );
}
function MovementLink({
  p,
  from,
  to,
  purchase = false,
}: {
  p: IntelligenceProduct;
  from: string;
  to: string;
  purchase?: boolean;
}) {
  return (
    <Link
      className="stock-text-button"
      href={`/app/movimentacoes?${new URLSearchParams({ productId: p.id, from, to, ...(purchase ? { kind: "IN" } : { kind: "CONSUMPTION" }) })}`}
    >
      Conferir registros <ArrowUpRight size={13} />
    </Link>
  );
}

export function IntelligenceWorkspace({
  property,
}: {
  property: PropertySummary;
}) {
  const [view, setView] = useState<IntelligenceView | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(initialFilters),
    [filters, setFilters] = useState(initialFilters),
    [page, setPage] = useState(1),
    [anomalyPage, setAnomalyPage] = useState(1);
  const [tab, setTab] = useState<Tab>("consumption"),
    [chosen, setChosen] = useState(""),
    [settings, setSettings] = useState(false);
  const request = useRef(0),
    tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const reload = useCallback(async () => {
    const seq = ++request.current;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({
      page: String(page),
      anomalyPage: String(anomalyPage),
      grouping: filters.grouping,
      horizonDays: String(filters.horizonDays),
    });
    for (const key of ["from", "to", "productId", "category"] as const)
      if (filters[key]) query.set(key, filters[key]);
    try {
      const next = await apiRequest<IntelligenceView>(
        `/api/properties/${property.id}/intelligence?${query}`,
      );
      if (seq !== request.current) return;
      setView(next);
      setDraft((previous) =>
        previous.from
          ? previous
          : {
              ...previous,
              from: next.result.period.from,
              to: next.result.period.to,
            },
      );
    } catch (e) {
      if (seq === request.current) setError((e as Error).message);
    } finally {
      if (seq === request.current) setLoading(false);
    }
  }, [property.id, filters, page, anomalyPage]);
  useEffect(() => {
    void reload();
    const focus = () => void reload();
    window.addEventListener("focus", focus);
    return () => {
      ++request.current;
      window.removeEventListener("focus", focus);
    };
  }, [reload]);
  const r = view?.result,
    selected = r?.products.find((p) => p.id === chosen) ?? r?.products[0];
  function selector(label: string) {
    return (
      <label>
        {label}
        <select
          aria-label={label}
          value={selected?.id ?? ""}
          onChange={(e) => setChosen(e.target.value)}
        >
          {r?.products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.archived ? " · Arquivado" : ""}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <div className="stock-workspace intelligence-workspace">
      <div className="stock-page-heading">
        <div>
          <span className="eyebrow section-label">
            DOS REGISTROS AO PLANEJAMENTO
          </span>
          <h1>Inteligência do estoque</h1>
          <p>
            Entenda o consumo, confira o valor armazenado e explore o próximo
            passo.
          </p>
        </div>
        <div className="stock-actions">
          <button
            className="stock-secondary"
            onClick={() => void reload()}
            disabled={loading}
            aria-label="Atualizar inteligência"
          >
            <RefreshCw size={16} />
          </button>
          {property.role === "ADMIN" && (
            <button
              className="stock-secondary"
              onClick={() => setSettings(true)}
            >
              {" "}
              <Settings2 size={16} />
              Critérios da inteligência
            </button>
          )}
          <Link className="button button-green" href="/app/alertas">
            Ver alertas <ArrowUpRight size={16} />
          </Link>
        </div>
      </div>
      <ErrorNotice text={error} />
      {!view && loading && (
        <p className="analysis-loading" role="status">
          <BarChart3 size={21} />
          Organizando períodos e referências…
        </p>
      )}
      {error && (
        <button className="stock-secondary" onClick={() => void reload()}>
          Tentar novamente
        </button>
      )}
      {view && r && (
        <>
          <div
            className={`analysis-reference ${loading || error ? "pending" : ""}`}
            role="status"
          >
            <span>
              {loading || error ? <Clock3 size={15} /> : <Check size={15} />}
              {loading
                ? "Atualizando; resultado anterior"
                : error
                  ? "Resultado anterior; atualização indisponível"
                  : "Dados conferidos nesta consulta"}
            </span>
            <small>
              Referência atual: {date(r.referenceDay)} · {r.timezone} · revisão{" "}
              {r.revision} · política {r.policyVersion}
            </small>
          </div>
          <form
            className="intel-filters"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setAnomalyPage(1);
              setFilters({ ...draft });
            }}
          >
            <label>
              Período: de
              <input
                type="date"
                required
                value={draft.from}
                max={shift(r.referenceDay, -1)}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              />
            </label>
            <label>
              Até
              <input
                type="date"
                required
                value={draft.to}
                max={shift(r.referenceDay, -1)}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              />
            </label>
            <label>
              Produto
              <select
                aria-label="Produto"
                value={draft.productId}
                onChange={(e) =>
                  setDraft({ ...draft, productId: e.target.value })
                }
              >
                <option value="">Todos</option>
                {view.options.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.archived ? " · Arquivado" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Categoria
              <select
                aria-label="Categoria"
                value={draft.category}
                onChange={(e) =>
                  setDraft({ ...draft, category: e.target.value })
                }
              >
                <option value="">Todas</option>
                {view.options.categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Agrupar
              <select
                aria-label="Agrupar"
                value={draft.grouping}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    grouping: e.target.value as Filters["grouping"],
                  })
                }
              >
                <option value="DAY">Dia</option>
                <option value="WEEK">Blocos de 7 dias</option>
                <option value="MONTH">Mês</option>
              </select>
            </label>
            <label>
              Horizonte de compra (dias)
              <input
                type="number"
                min={1}
                max={365}
                required
                value={draft.horizonDays}
                onChange={(e) =>
                  setDraft({ ...draft, horizonDays: Number(e.target.value) })
                }
              />
            </label>
            <button className="button button-green" disabled={loading}>
              Aplicar filtros
            </button>
          </form>
          <p className="analysis-footnote">
            Histórico: {date(r.period.from)} a {date(r.period.to)} (
            {r.period.days} dias). Comparação: {date(r.period.previousFrom)} a{" "}
            {date(r.period.previousTo)}. Saldo, planejamento e sinais vigentes
            mantêm a referência atual.
          </p>
          <div
            className="intel-tabs"
            role="tablist"
            aria-label="Análises do estoque"
          >
            {tabs.map((t, i) => (
              <button
                type="button"
                key={t.id}
                ref={(el) => {
                  tabButtons.current[i] = el;
                }}
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => {
                  const next =
                    e.key === "ArrowRight"
                      ? (i + 1) % tabs.length
                      : e.key === "ArrowLeft"
                        ? (i + tabs.length - 1) % tabs.length
                        : e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? tabs.length - 1
                            : -1;
                  if (next >= 0) {
                    e.preventDefault();
                    setTab(tabs[next].id);
                    tabButtons.current[next]?.focus();
                  }
                }}
              >
                {t.title}
              </button>
            ))}
          </div>
          <section
            id={`panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
            className="intel-tab-panel"
          >
            {!view.total ? (
              <div className="analysis-empty">
                <BarChart3 size={27} />
                <h2>Nenhum produto neste recorte.</h2>
                <p>
                  Revise os filtros ou traga os primeiros registros para
                  começar. As análises não presumem um histórico que ainda não
                  foi conferido.
                </p>
                <Link className="stock-secondary" href="/app/importar">
                  Trazer uma planilha <ArrowRight size={15} />
                </Link>
              </div>
            ) : (
              <>
                {tab === "consumption" && (
                  <>
                    <section className="stock-card">
                      <div className="stock-card-heading">
                        <div>
                          <span className="eyebrow section-label">
                            RITMO OBSERVADO
                          </span>
                          <h2>Consumo ao longo do tempo</h2>
                        </div>
                      </div>
                      <div className="intel-card-body">
                        {selector("Produto no gráfico")}
                        {selected && (
                          <>
                            <div className="intel-number">
                              <strong>{n(selected.currentConsumption)}</strong>
                              <span>
                                {selected.unit} registrados no período
                              </span>
                            </div>
                            <p className="analysis-footnote">
                              {comparison[selected.comparisonStatus]}
                              {selected.changePercent !== null
                                ? ` · ${n(selected.changePercent)}% frente ao intervalo anterior`
                                : ""}
                              . As barras somam somente consumo confirmado,
                              descontados os estornos.
                            </p>
                            <ConsumptionChart product={selected} />
                            <details className="analysis-table-details">
                              <summary>Ver série em tabela</summary>
                              <Table title="Série de consumo">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Intervalo</th>
                                      <th>Consumo ({selected.unit})</th>
                                      <th>Cobertura</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {selected.series.map((s) => (
                                      <tr key={s.from}>
                                        <td>
                                          {date(s.from)}
                                          {s.to !== s.from
                                            ? ` a ${date(s.to)}`
                                            : ""}
                                        </td>
                                        <td>
                                          {s.quantity === null
                                            ? "Não estimado"
                                            : n(s.quantity)}
                                        </td>
                                        <td>
                                          {s.coveredDays}/{s.totalDays} dias
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </Table>
                            </details>
                            <MovementLink
                              p={selected}
                              from={r.period.from}
                              to={r.period.to}
                            />
                          </>
                        )}
                      </div>
                    </section>
                    <section className="stock-card">
                      <div className="stock-card-heading">
                        <div>
                          <h2>Comparação entre períodos equivalentes</h2>
                          <p>
                            Sem cobertura integral, as quantidades são apenas os
                            registros conhecidos.
                          </p>
                        </div>
                      </div>
                      <Table title="Comparação de consumo">
                        <table>
                          <thead>
                            <tr>
                              <th>Produto</th>
                              <th>Atual registrado</th>
                              <th>Anterior registrado</th>
                              <th>Variação</th>
                              <th>Base</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.products.map((p) => (
                              <tr key={p.id}>
                                <td>
                                  <ProductLink p={p} />
                                </td>
                                <td>
                                  {n(p.currentConsumption)} {p.unit}
                                </td>
                                <td>
                                  {n(p.previousConsumption)} {p.unit}
                                </td>
                                <td>
                                  {p.changePercent === null
                                    ? "—"
                                    : `${n(p.changePercent)}%`}
                                </td>
                                <td>{comparison[p.comparisonStatus]}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </Table>
                    </section>
                    {selected && (
                      <section className="stock-card">
                        <div className="stock-card-heading">
                          <div>
                            <h2>Tendência recente · {selected.name}</h2>
                            <p>
                              Três blocos completos de 7 dias encerrados ontem;
                              independentes do filtro histórico.
                            </p>
                          </div>
                        </div>
                        <div className="intel-card-body">
                          <div className="intel-trend">
                            {selected.trend.blocks.map((b, i) => (
                              <div key={i}>
                                <small>
                                  Bloco {i + 1} ·{" "}
                                  {i === 0
                                    ? "mais antigo"
                                    : i === 2
                                      ? "mais recente"
                                      : "intermediário"}
                                </small>
                                <strong>
                                  {n(b)} {selected.unit}
                                </strong>
                              </div>
                            ))}
                          </div>
                          <p className="analysis-footnote">
                            {!selected.trend.covered
                              ? "Cobertura insuficiente para classificar a tendência."
                              : selected.trend.detected
                                ? `Crescimento em dois passos de pelo menos ${r.policy.trendPercent}%: conferir aumento progressivo e contexto sazonal.`
                                : "Sem aumento progressivo pelos critérios atuais. Isso não comprova ausência de variação ou sazonalidade."}
                          </p>
                        </div>
                      </section>
                    )}
                    <section className="stock-card">
                      <div className="stock-card-heading">
                        <div>
                          <h2>Retiradas para conferir</h2>
                          <p>
                            Janela vigente dos detectores:{" "}
                            {r.policy.comparisonDays} dias e registros de hoje,
                            sem incluir o evento na própria referência.
                          </p>
                        </div>
                        <span className="stock-badge">
                          {view.anomalies.total} sinais
                        </span>
                      </div>
                      {view.anomalies.total ? (
                        <>
                          <Table title="Retiradas acima da referência">
                            <table>
                              <thead>
                                <tr>
                                  <th>Produto / data</th>
                                  <th>Retirada</th>
                                  <th>Referência anterior</th>
                                  <th>Evidência</th>
                                </tr>
                              </thead>
                              <tbody>
                                {view.anomalies.rows.map((a) => (
                                  <tr key={a.movementId}>
                                    <td>
                                      <Link
                                        href={`/app/estoque/${a.productId}`}
                                      >
                                        {a.productName}
                                      </Link>
                                      <small>
                                        {date(a.day)} ·{" "}
                                        {a.destination ||
                                          "Destino não informado"}
                                      </small>
                                    </td>
                                    <td>
                                      {n(a.quantity)} {a.unit}
                                    </td>
                                    <td>
                                      Mediana {n(a.median)} · limite{" "}
                                      {n(a.threshold)} {a.unit}
                                      <small>
                                        {a.samples} amostras anteriores
                                      </small>
                                    </td>
                                    <td>
                                      <details>
                                        <summary>Como foi identificado</summary>
                                        <p className="analysis-footnote">
                                          {a.explanation}
                                        </p>
                                        <Link
                                          className="stock-text-button"
                                          href={`/app/movimentacoes?productId=${a.productId}&from=${a.day}&to=${a.day}`}
                                        >
                                          Conferir retirada
                                        </Link>
                                      </details>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </Table>
                          <Pager
                            page={view.anomalies.page}
                            total={view.anomalies.total}
                            change={setAnomalyPage}
                            label="Páginas de retiradas para conferir"
                          />
                        </>
                      ) : (
                        <div className="stock-empty-small">
                          Nenhum sinal identificado com amostra e cobertura
                          suficientes. Uma ausência de sinal não substitui a
                          conferência dos registros.
                        </div>
                      )}
                    </section>
                  </>
                )}
                {tab === "finance" && (
                  <>
                    <div className="intel-metrics">
                      <Metric
                        title="Valor físico atual conhecido"
                        value={money(r.summary.currentValue)}
                        note={`${r.summary.unpricedLots} lotes atuais sem custo`}
                      />
                      <Metric
                        title="Aquisições conhecidas no período"
                        value={money(r.summary.purchaseValue)}
                        note={`${r.summary.purchaseUnpriced} entradas sem custo · não comprova pagamento`}
                      />
                      <Metric
                        title="Consumo valorizado no período"
                        value={money(r.summary.consumptionValue)}
                        note={`${r.summary.consumptionUnpriced} retiradas sem custo · ao custo registrado`}
                      />
                    </div>
                    <section className="stock-card">
                      <div className="stock-card-heading">
                        <div>
                          <h2>Onde está o valor armazenado?</h2>
                          <p>
                            Valor atual por categoria, somando saldos ao custo
                            de cada lote.
                          </p>
                        </div>
                      </div>
                      <div className="intel-card-body">
                        <CategoryChart result={r} />
                      </div>
                      <Table title="Valores por categoria">
                        <table>
                          <thead>
                            <tr>
                              <th>Categoria</th>
                              <th>Estoque atual</th>
                              <th>Aquisições no período</th>
                              <th>Consumo no período</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.categories.map((c) => (
                              <tr key={c.category}>
                                <td>{c.category}</td>
                                <td>{money(c.currentValue)}</td>
                                <td>{money(c.purchaseValue)}</td>
                                <td>{money(c.consumptionValue)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </Table>
                    </section>
                    <section className="stock-card">
                      <div className="stock-card-heading">
                        <div>
                          <h2>Aquisições e variação de preços</h2>
                          <p>
                            Mesma unidade e produto; abertura e ajustes não são
                            compras.
                          </p>
                        </div>
                      </div>
                      <div className="intel-card-body">
                        {selector("Produto para conferir preços")}
                        {selected && (
                          <>
                            <p className="analysis-footnote">
                              Média ponderada dos saldos com custo conhecido:{" "}
                              {selected.weightedCost === null
                                ? "indisponível"
                                : `${unitMoney(selected.weightedCost)}/${selected.unit}`}
                              . Indicador separado; não reprecifica os lotes.
                            </p>
                            <PriceComparison product={selected} />
                            <p className="analysis-footnote">
                              Histórico abaixo: até 20 das {selected.priceTotal}{" "}
                              aquisições no período. Consulte todos os registros
                              pelo link; entradas estornadas ficam fora destes
                              totais.
                            </p>
                            <Table title="Aquisições do produto">
                              <table>
                                <thead>
                                  <tr>
                                    <th>Data / lote</th>
                                    <th>Quantidade</th>
                                    <th>Custo por unidade</th>
                                    <th>Fornecedor</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {selected.prices.map((p) => (
                                    <tr key={p.id}>
                                      <td>
                                        {date(p.day)}
                                        <small>{p.lotCode}</small>
                                      </td>
                                      <td>
                                        {n(p.quantity)} {selected.unit}
                                      </td>
                                      <td>
                                        {p.unitCost === null
                                          ? "Não informado"
                                          : `${unitMoney(p.unitCost)}/${selected.unit}`}
                                      </td>
                                      <td>{p.supplier ?? "Não informado"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </Table>
                            {!selected.prices.length && (
                              <p className="stock-empty-small">
                                Nenhuma aquisição registrada nesse período.
                              </p>
                            )}
                            <MovementLink
                              p={selected}
                              from={r.period.from}
                              to={r.period.to}
                              purchase
                            />
                          </>
                        )}
                      </div>
                    </section>
                  </>
                )}
                {tab === "excess" && (
                  <>
                    <div className="intel-metrics">
                      <Metric
                        title="Valor conhecido sem consumo"
                        value={money(r.summary.idleKnownValue)}
                        note={`Exige ${r.policy ? "o período de inatividade configurado" : "histórico coberto"}; saldo físico`}
                      />
                      <Metric
                        title="Valor do excedente estimado"
                        value={money(r.summary.excessKnownValue)}
                        note={`Horizonte desejado: ${r.policy.excessDays} dias`}
                      />
                      <Metric
                        title="União das exposições"
                        value={money(r.summary.exposureKnownValue)}
                        note="Parado e excesso sem contar o mesmo lote duas vezes"
                      />
                    </div>
                    <p className="intel-callout">
                      Esses valores não são perdas confirmadas. Não some esta
                      exposição à de validade: um lote pode aparecer nos dois
                      contextos.
                    </p>
                    <section className="stock-card">
                      <div className="stock-card-heading">
                        <div>
                          <h2>Excesso e capital parado por produto</h2>
                          <p>
                            Saldo elegível para excesso; saldo físico para
                            capital sem consumo. Custos ausentes continuam
                            explícitos.
                          </p>
                        </div>
                      </div>
                      <Table title="Excesso e capital parado">
                        <table>
                          <thead>
                            <tr>
                              <th>Produto</th>
                              <th>Excedente estimado</th>
                              <th>Valor sem consumo</th>
                              <th>Participação no valor atual</th>
                              <th>Base</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.products
                              .slice()
                              .sort(
                                (a, b) =>
                                  Number(b.exposureKnownValue) -
                                    Number(a.exposureKnownValue) ||
                                  a.name.localeCompare(b.name),
                              )
                              .map((p) => (
                                <tr key={p.id}>
                                  <td>
                                    <ProductLink p={p} />
                                  </td>
                                  <td>
                                    {p.excessQuantity === null
                                      ? "Sem base para estimar"
                                      : `${n(p.excessQuantity)} ${p.unit}`}
                                    <small>
                                      {money(p.excessKnownValue)} conhecidos
                                    </small>
                                  </td>
                                  <td>
                                    {money(p.idleKnownValue)}
                                    <small>
                                      {p.idle
                                        ? "Sem consumo confirmado no intervalo coberto"
                                        : p.idleCovered
                                          ? "Não classificado como parado"
                                          : "Cobertura insuficiente"}
                                    </small>
                                  </td>
                                  <td>
                                    {p.knownValueShare === null
                                      ? "—"
                                      : `${n(p.knownValueShare)}%`}
                                    <small>
                                      Do valor conhecido da propriedade
                                    </small>
                                  </td>
                                  <td>
                                    <details>
                                      <summary>Conferir limitações</summary>
                                      <ul className="intel-limitations">
                                        {p.limitations.map((l) => (
                                          <li key={l}>{l}</li>
                                        ))}
                                        <li>
                                          Excesso exige média válida, sem alta
                                          irregularidade. Horizonte{" "}
                                          {r.policy.excessDays} dias; mínimo
                                          informado preservado.
                                        </li>
                                      </ul>
                                    </details>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </Table>
                    </section>
                  </>
                )}
                {tab === "planning" && (
                  <>
                    <section className="stock-card">
                      <div className="stock-card-heading">
                        <div>
                          <span className="eyebrow section-label">
                            PLANEJAR ANTES DE COMPRAR
                          </span>
                          <h2>Reposição sugerida</h2>
                          <p>
                            Alvo = maior entre mínimo e demanda no horizonte.
                            Desconta saldo elegível aproveitável, considerando
                            vencimentos.
                          </p>
                        </div>
                      </div>
                      <div className="intel-card-body">
                        <p className="intel-callout">
                          Nenhuma chegada agendada foi considerada. Ainda não há
                          pedidos confirmados no aplicativo. Uma simulação não
                          cria uma compra.
                        </p>
                        <div className="intel-metrics">
                          <Metric
                            title="Orçamento conhecido estimado"
                            value={money(r.summary.estimatedBudget)}
                            note="Referências históricas; não é cotação garantida"
                          />
                          <Metric
                            title="Sugestões sem preço de referência"
                            value={String(r.summary.budgetMissingProducts)}
                            note="Não entram no orçamento conhecido"
                          />
                        </div>
                      </div>
                      <Table title="Sugestão de reposição">
                        <table>
                          <thead>
                            <tr>
                              <th>Produto</th>
                              <th>Horizonte / alvo</th>
                              <th>Compra sugerida</th>
                              <th>Orçamento estimado</th>
                              <th>Base</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.products
                              .filter((p) => !p.archived)
                              .map((p) => (
                                <tr key={p.id}>
                                  <td>
                                    <ProductLink p={p} />
                                  </td>
                                  <td>
                                    {p.planning.horizonDays} dias
                                    <small>
                                      {p.planning.targetQuantity === null
                                        ? "Alvo indisponível"
                                        : `${n(p.planning.targetQuantity)} ${p.unit}`}
                                    </small>
                                  </td>
                                  <td>
                                    {p.planning.suggestedQuantity === null
                                      ? "Sem base"
                                      : `${n(p.planning.suggestedQuantity)} ${p.unit}`}
                                  </td>
                                  <td>
                                    {p.planning.estimatedBudget === null
                                      ? "Preço não informado"
                                      : money(p.planning.estimatedBudget)}
                                  </td>
                                  <td>
                                    {p.planning.basis === "MINIMUM_ONLY"
                                      ? "Somente mínimo; sem projeção de consumo"
                                      : p.planning.basis === "INSUFFICIENT"
                                        ? "Sem mínimo e média válidos"
                                        : "Demanda e mínimo, sem duplicar necessidade"}
                                    <small>{p.planning.priceReference}</small>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </Table>
                    </section>
                    <Simulator property={property} view={view} />
                  </>
                )}
                <Pager
                  page={view.page}
                  total={view.total}
                  change={setPage}
                  label="Páginas de produtos analisados"
                />
              </>
            )}
          </section>
          <details className="intel-assumptions">
            <summary>Premissas e limites desta leitura</summary>
            <ul>
              {r.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <p>
              Gráficos e linhas exibem os produtos da página atual; indicadores
              e categorias consolidam todos os produtos que atendem aos filtros.
              Análises de sinais não são diagnóstico agronômico.
            </p>
          </details>
        </>
      )}
      {settings && (
        <IntelligencePolicyDialog
          property={property}
          close={() => setSettings(false)}
          saved={async () => {
            setSettings(false);
            await reload();
          }}
        />
      )}
    </div>
  );
}

function ConsumptionChart({ product }: { product: IntelligenceProduct }) {
  const max = Math.max(
    1,
    ...product.series.map((s) => Number(s.quantity ?? 0)),
  );
  return (
    <>
      <div className="intel-consumption-chart" aria-hidden="true">
        {product.series.map((s) => (
          <span
            key={s.from}
            className={s.quantity === null ? "missing" : ""}
            title={`${date(s.from)}: ${s.quantity === null ? "sem cobertura" : `${n(s.quantity)} ${product.unit}`}`}
            style={{
              height:
                s.quantity === null
                  ? "100%"
                  : `${Math.max(2, (Number(s.quantity) / max) * 100)}%`,
            }}
          />
        ))}
      </div>
      <p className="analysis-footnote">
        Colunas sem cobertura aparecem hachuradas; não representam consumo zero.
      </p>
    </>
  );
}
function CategoryChart({ result }: { result: IntelligenceResult }) {
  const max = Math.max(
    1,
    ...result.categories.map((c) => Number(c.currentValue)),
  );
  return (
    <div className="intel-category-chart" aria-hidden="true">
      {result.categories.map((c) => (
        <div key={c.category}>
          <span>{c.category}</span>
          <div>
            <i style={{ width: `${(Number(c.currentValue) / max) * 100}%` }} />
          </div>
          <strong>{money(c.currentValue)}</strong>
        </div>
      ))}
    </div>
  );
}
function PriceComparison({ product: p }: { product: IntelligenceProduct }) {
  const a = p.priceComparison.previous,
    b = p.priceComparison.current;
  return (
    <div className="intel-price-comparison">
      <h3>Últimas aquisições com preço conhecido até o fim do período</h3>
      {a && b ? (
        <>
          <p>
            {date(a.day)}: {unitMoney(a.unitCost!)}/{p.unit}{" "}
            <ArrowRight size={14} /> {date(b.day)}: {unitMoney(b.unitCost!)}/
            {p.unit}
          </p>
          <p>
            {p.priceChangePercent === null
              ? "Preço anterior zero: variação percentual não calculável."
              : `Variação de ${n(p.priceChangePercent)}%. Impacto comparativo na quantidade da última compra: ${money(p.priceImpact!)}.`}
          </p>
        </>
      ) : (
        <p>
          São necessárias duas aquisições com custo informado. Abertura e
          ajustes não entram na comparação.
        </p>
      )}
      <small>
        Comparação histórica; fornecedores podem diferir. Não comprova
        sobrepreço ou perda e não muda o custo dos lotes antigos.
      </small>
    </div>
  );
}

type SimulationForm = {
  productId: string;
  horizonDays: number;
  consumptionPercent: number;
  quantity: string;
  arrivalDay: string;
  expiryStatus: "NA" | "DATED" | "UNKNOWN";
  expiresOn: string;
  unitCost: string;
};
function Simulator({
  property,
  view,
}: {
  property: PropertySummary;
  view: IntelligenceView;
}) {
  const products = view.options.products.filter((p) => !p.archived);
  const [form, setForm] = useState<SimulationForm>({
    productId: products[0]?.id ?? "",
    horizonDays: 30,
    consumptionPercent: 0,
    quantity: "0",
    arrivalDay: shift(view.result.referenceDay, 7),
    expiryStatus: "NA",
    expiresOn: "",
    unitCost: "",
  });
  const [result, setResult] = useState<SimulationView | null>(null),
    [signature, setSignature] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const unit = products.find((p) => p.id === form.productId)?.unit ?? "";
  const old =
    !!result &&
    (signature !== JSON.stringify(form) ||
      result.revision !== view.result.revision ||
      result.policyVersion !== view.result.policyVersion ||
      result.ruleVersion !== view.result.ruleVersion ||
      result.referenceDay !== view.result.referenceDay);
  function field<K extends keyof SimulationForm>(
    key: K,
    value: SimulationForm[K],
  ) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }
  return (
    <section className="stock-card intel-simulator">
      <div className="stock-card-heading">
        <div>
          <span className="eyebrow section-label">EXPLORE UM CENÁRIO</span>
          <h2>E se o consumo ou a reposição mudar?</h2>
          <p>Uma comparação hipotética, sem alterar seu estoque.</p>
        </div>
        <FlaskConical size={25} />
      </div>
      <form
        className="stock-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const inputSignature = JSON.stringify(form);
          try {
            const data = await apiRequest<SimulationView>(
              `/api/properties/${property.id}/intelligence/simulate`,
              {
                ...form,
                quantity: form.quantity.replace(",", "."),
                unitCost: form.unitCost
                  ? form.unitCost.replace(",", ".")
                  : undefined,
                expiresOn:
                  form.expiryStatus === "DATED" ? form.expiresOn : undefined,
              },
            );
            setResult(data);
            setSignature(inputSignature);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="intel-simulation-fields">
          <label>
            Produto do cenário
            <select
              aria-label="Produto do cenário"
              required
              value={form.productId}
              onChange={(e) => field("productId", e.target.value)}
            >
              <option value="" disabled>
                Selecione
              </option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Duração do cenário (dias)
            <input
              type="number"
              min={1}
              max={365}
              required
              value={form.horizonDays}
              onChange={(e) => field("horizonDays", Number(e.target.value))}
            />
          </label>
          <label>
            Variação de consumo (%)
            <input
              type="number"
              min={-100}
              max={500}
              required
              value={form.consumptionPercent}
              onChange={(e) =>
                field("consumptionPercent", Number(e.target.value))
              }
            />
          </label>
          <label>
            Reposição hipotética ({unit})
            <input
              required
              inputMode="decimal"
              maxLength={22}
              value={form.quantity}
              onChange={(e) => field("quantity", e.target.value)}
            />
          </label>
          <label>
            Data hipotética de chegada
            <input
              type="date"
              min={view.result.referenceDay}
              max={shift(view.result.referenceDay, 365)}
              required
              value={form.arrivalDay}
              onChange={(e) => field("arrivalDay", e.target.value)}
            />
          </label>
          <label>
            Validade hipotética
            <select
              aria-label="Validade hipotética"
              value={form.expiryStatus}
              onChange={(e) =>
                field(
                  "expiryStatus",
                  e.target.value as SimulationForm["expiryStatus"],
                )
              }
            >
              <option value="NA">Não se aplica neste cenário</option>
              <option value="DATED">Informar data</option>
              <option value="UNKNOWN">
                Desconhecida · fora do saldo elegível
              </option>
            </select>
          </label>
          {form.expiryStatus === "DATED" && (
            <label>
              Data de validade da reposição
              <input
                type="date"
                required
                min={form.arrivalDay}
                value={form.expiresOn}
                onChange={(e) => field("expiresOn", e.target.value)}
              />
            </label>
          )}
          <label>
            Custo hipotético por unidade (R$)
            <input
              inputMode="decimal"
              maxLength={22}
              value={form.unitCost}
              onChange={(e) => field("unitCost", e.target.value)}
              placeholder="Opcional, sem cotação presumida"
            />
          </label>
        </div>
        <p className="analysis-footnote">
          A demanda não atendida não é acumulada como encomenda. A chegada
          ocorre no início do dia indicado; antes dela, a quantidade ainda não
          está disponível.
        </p>
        <ErrorNotice text={error} />
        <button
          className="button button-green"
          disabled={busy || !products.length}
        >
          {busy ? "Calculando cenário…" : "Comparar cenário"}
        </button>
      </form>
      {result && (
        <div className="intel-simulation-result">
          <div
            className={`analysis-reference ${old ? "pending" : ""}`}
            role="status"
          >
            <span>
              {old
                ? "Cenário anterior; recalcule após as mudanças"
                : "Cenário calculado sem alterar o estoque"}
            </span>
            <small>
              {result.productName} · referência {date(result.referenceDay)} ·
              revisão {result.revision} · política {result.policyVersion}
            </small>
          </div>
          {result.baseline && result.scenario ? (
            <>
              <div className="intel-metrics">
                <Metric
                  title="Saldo final no cenário base"
                  value={`${n(result.baseline.closingBalance)} ${result.unit}`}
                  note={`${result.baseline.shortageDays} dias com demanda não atendida`}
                />
                <Metric
                  title="Saldo final no cenário simulado"
                  value={`${n(result.scenario.closingBalance)} ${result.unit}`}
                  note={`${result.scenario.shortageDays} dias com demanda não atendida`}
                />
                <Metric
                  title="Falta antes da chegada hipotética"
                  value={`${n(result.scenario.unmetBeforeArrival)} ${result.unit}`}
                  note={
                    result.scenario.firstShortageDay
                      ? `Primeira falta: ${date(result.scenario.firstShortageDay)}`
                      : "Sem falta projetada nesse horizonte"
                  }
                />
              </div>
              <p className="analysis-footnote">
                Consumo base: {n(result.baselineRate!)} {result.unit}/dia;
                cenário: {n(result.scenarioRate!)} {result.unit}/dia.
                Vencimentos no cenário: {n(result.scenario.expiredQuantity)}{" "}
                {result.unit}.
                {result.estimatedCost !== null
                  ? ` Custo hipotético da reposição: ${money(result.estimatedCost)}.`
                  : " Custo de reposição não informado."}
              </p>
              <ProjectionChart view={result} />
              <details className="analysis-table-details">
                <summary>Ver projeção diária em tabela</summary>
                <Table title="Comparação diária dos cenários">
                  <table>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Saldo base</th>
                        <th>Saldo simulado</th>
                        <th>Chegada</th>
                        <th>Não atendido</th>
                        <th>Vencido no dia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.scenario.points.map((point, i) => (
                        <tr key={point.day}>
                          <td>{date(point.day)}</td>
                          <td>
                            {n(result.baseline!.points[i].balance)}{" "}
                            {result.unit}
                          </td>
                          <td>
                            {n(point.balance)} {result.unit}
                          </td>
                          <td>
                            {n(point.arrival)} {result.unit}
                          </td>
                          <td>
                            {n(point.unmet)} {result.unit}
                          </td>
                          <td>
                            {n(point.expired)} {result.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Table>
              </details>
            </>
          ) : (
            <p className="intel-callout">
              Ainda não há base suficiente para projetar este produto. Confira a
              cobertura do histórico e os registros de consumo.
            </p>
          )}
          <ul className="intel-limitations">
            {result.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
function ProjectionChart({ view }: { view: SimulationView }) {
  const max = Math.max(
    1,
    ...view.baseline!.points.map((p) => Number(p.balance)),
    ...view.scenario!.points.map((p) => Number(p.balance)),
  );
  const points = (values: { balance: string }[]) =>
    values
      .map(
        (p, i) =>
          `${15 + (i / Math.max(1, values.length - 1)) * 730},${165 - (Number(p.balance) / max) * 145}`,
      )
      .join(" ");
  return (
    <div className="intel-projection-chart">
      <div className="intel-legend">
        <span>Base</span>
        <span>Simulado</span>
      </div>
      <svg aria-hidden="true" viewBox="0 0 760 180" preserveAspectRatio="none">
        <line x1="15" y1="165" x2="745" y2="165" stroke="#d9e2d3" />
        <polyline
          points={points(view.baseline!.points)}
          fill="none"
          stroke="#8b7052"
          strokeWidth="3"
          strokeDasharray="7 5"
        />
        <polyline
          points={points(view.scenario!.points)}
          fill="none"
          stroke="#315d37"
          strokeWidth="3"
        />
      </svg>
      <p className="analysis-footnote">
        Saldo elegível ao fim de cada dia. A tabela abaixo contém os valores e
        as quantidades não atendidas.
      </p>
    </div>
  );
}

const policyFields: {
  key: Exclude<keyof IntelligencePolicy, "minimumChangeQuantity">;
  label: string;
  min: number;
  max: number;
}[] = [
  {
    key: "comparisonDays",
    label: "Janela de comparação (dias por período)",
    min: 7,
    max: 90,
  },
  {
    key: "consumptionChangePercent",
    label: "Mudança de consumo mínima (%)",
    min: 10,
    max: 500,
  },
  {
    key: "trendPercent",
    label: "Crescimento mínimo por bloco semanal (%)",
    min: 5,
    max: 200,
  },
  {
    key: "withdrawalMultiplier",
    label: "Multiplicador da mediana para retirada incomum",
    min: 2,
    max: 10,
  },
  {
    key: "withdrawalMinSamples",
    label: "Retiradas anteriores mínimas na amostra",
    min: 5,
    max: 50,
  },
  {
    key: "excessDays",
    label: "Horizonte desejado para excesso (dias)",
    min: 7,
    max: 730,
  },
  {
    key: "priceChangePercent",
    label: "Variação mínima de preço (%)",
    min: 5,
    max: 500,
  },
  {
    key: "highValuePercent",
    label: "Participação mínima para alto valor (%)",
    min: 1,
    max: 100,
  },
];
function IntelligencePolicyDialog({
  property,
  close,
  saved,
}: {
  property: PropertySummary;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [base, setBase] = useState<AnalysisPolicy | null>(null),
    [config, setConfig] = useState(defaultIntelligencePolicy),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    apiRequest<AnalysisView>(`/api/properties/${property.id}/analysis`)
      .then((v) => {
        if (active) {
          setBase(v.policy);
          setConfig({ ...defaultIntelligencePolicy, ...v.policy.intelligence });
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [property.id]);
  return (
    <AnalysisDialog title="Critérios da inteligência" close={close}>
      <form
        className="stock-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!base) return;
          setBusy(true);
          setError("");
          try {
            await apiRequest(`/api/properties/${property.id}/analysis/policy`, {
              policyVersion: base.policyVersion,
              reorderDays: base.reorderDays,
              expiryWarningDays: base.expiryWarningDays,
              inactivityDays: base.inactivityDays,
              intelligence: {
                ...config,
                minimumChangeQuantity: config.minimumChangeQuantity.replace(
                  ",",
                  ".",
                ),
              },
              reason,
            });
            await saved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="stock-help">
          Políticas do AgroMind, configuradas pela propriedade. Alterar um
          critério cria uma nova versão e reavalia os alertas. Não há ajuste
          sazonal automático.
        </p>
        {!base && !error && <p role="status">Carregando política atual…</p>}
        <div className="stock-form-grid">
          {policyFields.map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                disabled={!base || busy}
                required
                type="number"
                min={f.min}
                max={f.max}
                value={config[f.key]}
                onChange={(e) =>
                  setConfig({ ...config, [f.key]: Number(e.target.value) })
                }
              />
            </label>
          ))}
        </div>
        <label>
          Piso da diferença em quantidade (na unidade base de cada produto)
          <input
            disabled={!base || busy}
            required
            inputMode="decimal"
            maxLength={13}
            value={config.minimumChangeQuantity}
            onChange={(e) =>
              setConfig({ ...config, minimumChangeQuantity: e.target.value })
            }
          />
        </label>
        <p className="stock-help">
          Para retiradas incomuns, o limite considera também mediana + 3 ×
          desvio absoluto mediano. Até 200 eventos anteriores em 30 dias; o
          próprio evento é excluído. A comparação de períodos exige ao menos 3
          retiradas por período.
        </p>
        <label>
          Motivo da alteração dos critérios
          <textarea
            disabled={!base || busy}
            required
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <ErrorNotice text={error} />
        <button className="button button-green" disabled={busy || !base}>
          {busy ? "Salvando…" : "Salvar critérios e reavaliar"}
        </button>
      </form>
    </AnalysisDialog>
  );
}

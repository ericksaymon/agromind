"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  FileSpreadsheet,
  LoaderCircle,
  Package,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { apiRequest, RequestError } from "@/lib/auth-client";
import { ProductAnalytics, ClassifyMovement } from "@/components/analysis-workspace";
import {
  stockKinds,
  stockUnits,
  type InventoryView,
  type ProductView,
  type MovementView,
  type MovementInput,
  type PropertySummary,
} from "../../../../packages/contracts/src/index";
export const number = (value: string | number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 }).format(
    Number(value),
  );
export const money = (value: string | number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(value),
  );
const unitMoney = (value: string) => new Intl.NumberFormat("pt-BR", {style:"currency",currency:"BRL",minimumFractionDigits:2,maximumFractionDigits:4}).format(Number(value));
const valueLabel = (p: ProductView) =>
  Number(p.balance) > 0 && p.unpricedBalance === p.balance
    ? "Não informado"
    : money(p.knownValue);
export const localDay = (zone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const inputNumber = (value: string) => value.trim().replace(",", ".");
export function StockDialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => {
      d?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="stock-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <div>
          <span className="eyebrow section-label">ESTOQUE DA PROPRIEDADE</span>
          <h2>{title}</h2>
        </div>
        <button
          type="button"
          className="stock-icon-button"
          onClick={close}
          aria-label="Fechar"
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Feedback({ error }: { error: string }) {
  return error ? (
    <div className="stock-error" role="alert">
      {error}
    </div>
  ) : null;
}
export function Pending() {
  return (
    <span className="stock-loading" role="status">
      <LoaderCircle size={18} className="spin" /> Carregando os dados da
      propriedade…
    </span>
  );
}
export function StockWorkspace({
  property,
  productId,
  history = false,
  historyProductId,
  historyFilters,
}: {
  property: PropertySummary;
  productId?: string;
  history?: boolean;
  historyProductId?: string;
  historyFilters?: { kind?: string; from?: string; to?: string };
}) {
  const [inventory, setInventory] = useState<InventoryView | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [status, setStatus] = useState("active");
  const [dialog, setDialog] = useState<
      "product" | "movement" | "archive" | null
    >(null),
    [edit, setEdit] = useState<ProductView | null>(null);
  const [moving, setMoving] = useState(""),
    [movingKind, setMovingKind] = useState<MovementInput["kind"]>("IN");
  const latestInventory = useRef(0);
  const base = `/api/properties/${property.id}`;
  const reload = useCallback(async () => {
    const requestId = ++latestInventory.current;
    setError("");
    try {
      const next = await apiRequest<InventoryView>(`${base}/inventory`);
      if (requestId === latestInventory.current) setInventory(next);
    } catch (e) {
      if (requestId === latestInventory.current) setError((e as Error).message);
    }
  }, [base]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const canWrite = property.role !== "VIEWER",
    product = inventory?.products.find((p) => p.id === productId);
  async function done(message: string, thenRegister?: string) {
    setNotice(message);
    await reload();
    if (thenRegister) {
      setMoving(thenRegister);
      setMovingKind("OPENING");
      setDialog("movement");
    } else setDialog(null);
  }
  const filtered =
    inventory?.products.filter(
      (p) =>
        (status === "all" ||
          (status === "archived" ? p.archived : !p.archived)) &&
        (!category || p.category === category) &&
        p.name
          .toLocaleLowerCase("pt-BR")
          .includes(query.toLocaleLowerCase("pt-BR")),
    ) || [];
  return (
    <div className="stock-workspace">
      <div className="stock-page-heading">
        <div>
          <span className="eyebrow section-label">
            {history
              ? "RASTREABILIDADE"
              : productId
                ? "DETALHE DO INSUMO"
                : "ESTOQUE DA PROPRIEDADE"}
          </span>
          <h1>
            {history
              ? "Movimentações"
              : productId
                ? product?.name || "Detalhes do produto"
                : "Meus insumos"}
          </h1>
          <p>
            {history
              ? "Entradas, consumo e correções, com origem e responsável."
              : productId
                ? "Saldo por lote, custos e histórico em um só lugar."
                : `Organize o que entra e o que sai de ${property.name}.`}
          </p>
        </div>
        <div className="stock-actions">
          <button
            className="stock-secondary"
            onClick={() => {
              void reload();
            }}
            aria-label="Atualizar estoque"
          >
            <RefreshCw size={16} />
          </button>
          {canWrite && (
            <>
              <button
                className="stock-secondary"
                onClick={() => {
                  setMoving(product?.id || "");
                  setMovingKind("IN");
                  setDialog("movement");
                }}
                disabled={!inventory?.products.some((p) => !p.archived)}
              >
                <ArrowUpRight size={16} />
                Movimentar
              </button>
              {!productId && !history && (
                <button
                  className="button button-green"
                  onClick={() => {
                    setEdit(null);
                    setDialog("product");
                  }}
                >
                  <Plus size={16} />
                  Novo produto
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <Feedback error={error} />
      {notice && (
        <p className="stock-notice" role="status">
          <Check size={16} />
          {notice}
        </p>
      )}
      {!inventory ? (
        <Pending />
      ) : history ? (
        <History
          property={property}
          revision={inventory.revision}
          products={inventory.products}
          productId={historyProductId}
          defaultFilters={historyFilters}
          refresh={reload}
        />
      ) : productId ? (
        product ? (
          <>
            <Link href="/app/estoque" className="stock-back">
              <ArrowLeft size={15} />
              Voltar ao estoque
            </Link>
            <div className="stock-summary">
              <Summary
                label="Saldo atual"
                value={`${number(product.balance)} ${product.unit}`}
              />
              <Summary
                label="Estoque mínimo"
                value={product.minimumKnown ? `${number(product.minimum)} ${product.unit}` : "Não confirmado"}
              />
              <Summary
                label="Valor conhecido"
                value={valueLabel(product)}
                note={
                  Number(product.unpricedBalance) > 0
                    ? `${number(product.unpricedBalance)} ${product.unit} sem custo informado`
                    : "Custos em reais, por lote"
                }
              />
            </div>
            <section className="stock-card">
              <div className="stock-card-heading">
                <div>
                  <h2>Dados do produto</h2>
                  <p>
                    {product.category} · Unidade base: {product.unit} ·{" "}
                    {product.archived ? "Arquivado" : "Ativo"}
                  </p>
                </div>
                {canWrite && (
                  <div className="stock-actions">
                    <button
                      className="stock-secondary"
                      onClick={() => {
                        setEdit(product);
                        setDialog("product");
                      }}
                    >
                      Editar
                    </button>
                    {property.role === "ADMIN" && (
                      <button
                        className="stock-secondary"
                        onClick={() => setDialog("archive")}
                      >
                        {product.archived ? "Reativar" : "Arquivar"}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <p className="stock-inline-note">
                Saldo calculado pelos movimentos confirmados. A unidade base é
                preservada depois da primeira movimentação.
              </p>
            </section>
            {!product.archived && <ProductAnalytics property={property} productId={product.id} revision={inventory.revision} stockProduct={product} edit={() => { setEdit(product); setDialog("product"); }} />}
            <section className="stock-card">
              <div className="stock-card-heading">
                <div>
                  <h2 id="lotes" tabIndex={-1}>Lotes e validades</h2>
                  <p>
                    Na retirada, sugerimos o lote elegível que vence primeiro.
                  </p>
                </div>
              </div>
              {!product.lots.length ? (
                <div className="stock-empty-small">
                  Nenhum lote ainda. Registre uma abertura ou entrada para
                  começar.
                </div>
              ) : (
                <div
                  className="stock-table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Lotes do produto"
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Lote</th>
                        <th>Saldo</th>
                        <th>Validade</th>
                        <th>Custo unitário</th>
                        <th>Fornecedor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {product.lots.map((l) => (
                        <tr key={l.id}>
                          <td>
                            <strong>{l.code}</strong>
                          </td>
                          <td>
                            {number(l.balance)} {product.unit}
                          </td>
                          <td>
                            {l.expiresOn ? (
                              <>
                                <span
                                  className={
                                    l.expiresOn < localDay(property.timezone)
                                      ? "stock-badge danger"
                                      : "stock-badge"
                                  }
                                >
                                  {l.expiresOn.split("-").reverse().join("/")}
                                </span>
                                {l.expiresOn < localDay(property.timezone) && (
                                  <small>Vencido · uso bloqueado</small>
                                )}
                              </>
                            ) : l.expiryStatus === "NA" ? (
                              "Não se aplica"
                            ) : (
                              "Não informada"
                            )}
                          </td>
                          <td>
                            {l.unitCost === null
                              ? "Não informado"
                              : unitMoney(l.unitCost)}
                          </td>
                          <td>{l.supplier || "Não informado"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <History
              property={property}
              revision={inventory.revision}
              products={inventory.products}
              productId={product.id}
              refresh={reload}
            />
          </>
        ) : (
          <div className="stock-empty-small">
            Produto não encontrado nesta propriedade.{" "}
            <Link href="/app/estoque">Voltar ao estoque</Link>
          </div>
        )
      ) : (
        <>
          <section className="stock-card">
            <div className="stock-toolbar-main">
              <label className="stock-search">
                <Search size={17} />
                <span className="sr-only">Buscar produto</span>
                <input
                  placeholder="Buscar pelo nome do insumo"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <label>
                <span className="sr-only">Filtrar categoria</span>
                <select
                  aria-label="Filtrar categoria"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">Todas as categorias</option>
                  {[...new Set(inventory.products.map((p) => p.category))]
                    .sort()
                    .map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                </select>
              </label>
              <select
                aria-label="Situação do produto"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="active">Ativos</option>
                <option value="archived">Arquivados</option>
                <option value="all">Todos</option>
              </select>
            </div>
            {!inventory.products.length ? (
              <div className="stock-empty">
                <Package size={38} />
                <h2>Pronto para receber o primeiro insumo.</h2>
                <p>
                  Cadastre o produto e registre sua quantidade inicial, ou traga
                  uma planilha para conferir antes de importar.
                </p>
                {canWrite && (
                  <div className="stock-actions">
                    <button
                      className="button button-green"
                      onClick={() => {
                        setEdit(null);
                        setDialog("product");
                      }}
                    >
                      <Plus size={16} />
                      Cadastrar primeiro produto
                    </button>
                    <Link href="/app/importar" className="stock-secondary">
                      <FileSpreadsheet size={16} />
                      Importar planilha
                    </Link>
                  </div>
                )}
              </div>
            ) : !filtered.length ? (
              <div className="stock-empty-small">
                Nenhum produto corresponde aos filtros.
              </div>
            ) : (
              <div
                className="stock-table-scroll"
                role="region"
                aria-label="Lista de insumos"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Insumo / categoria</th>
                      <th>Saldo</th>
                      <th>Mínimo</th>
                      <th>Valor conhecido</th>
                      <th>Situação</th>
                      <th>
                        <span className="sr-only">Abrir produto</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/app/estoque/${p.id}`} prefetch={false}>
                            <strong>{p.name}</strong>
                          </Link>
                          <small>{p.category}</small>
                        </td>
                        <td>
                          {number(p.balance)}{" "}
                          <small className="inline-unit">{p.unit}</small>
                        </td>
                        <td>
                          {p.minimumKnown ? `${number(p.minimum)} ${p.unit}` : "Não confirmado"}
                        </td>
                        <td>
                          {valueLabel(p)}
                          {Number(p.unpricedBalance) > 0 && (
                            <small>Parcial · há saldo sem custo</small>
                          )}
                        </td>
                        <td>
                          <span
                            className={`stock-badge ${!p.archived && p.minimumKnown && Number(p.balance) < Number(p.minimum) ? "warn" : ""}`}
                          >
                            {p.archived
                              ? "Arquivado"
                              : Number(p.balance) === 0
                                ? "Sem saldo"
                                : p.minimumKnown && Number(p.balance) < Number(p.minimum)
                                  ? "Físico abaixo do mínimo"
                                  : "Saldo registrado"}
                          </span>
                        </td>
                        <td>
                          <Link
                            className="stock-row-link"
                            href={`/app/estoque/${p.id}`}
                            aria-label={`Ver ${p.name}`}
                          >
                            <ArrowRight size={17} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className="stock-footnote">
            {filtered.length} de {inventory.products.length} produtos · Valores
            conhecidos em reais. Custos ausentes permanecem sem valor informado.
          </p>
        </>
      )}
      {dialog === "product" && inventory && (
        <ProductForm
          property={property}
          revision={inventory.revision}
          product={edit}
          products={inventory.products}
          close={() => setDialog(null)}
          done={done}
        />
      )}
      {dialog === "movement" && inventory && (
        <MovementForm
          property={property}
          inventory={inventory}
          initialProduct={moving}
          initialKind={movingKind}
          close={() => setDialog(null)}
          done={done}
          reload={reload}
        />
      )}
      {dialog === "archive" && product && inventory && (
        <ArchiveForm
          property={property}
          product={product}
          revision={inventory.revision}
          close={() => setDialog(null)}
          done={done}
        />
      )}
    </div>
  );
}
function Summary({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </article>
  );
}
const nameKeyOf = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const categoryHints: [RegExp, string][] = [
  [/diesel|gasolina|etanol|querosene/, "Combustíveis"],
  [/oleo|graxa|lubrific|fluido hidraulico/, "Lubrificantes"],
  [/ureia|npk|fertiliz|adubo|fosfato|cloreto de potassio|kcl/, "Fertilizantes"],
  [/calcario|gesso|corretivo|cal /, "Corretivos"],
  [/semente|muda/, "Sementes"],
  [/herbicida|fungicida|inseticida|glifosato|defensivo|biologico/, "Defensivos e biológicos"],
  [/filtro|correia|rolamento|peca|parafuso|pneu/, "Peças e manutenção"],
  [/mangueira|gotejador|irriga|aspersor/, "Irrigação"],
  [/luva|bota|mascara|capacete|epi/, "EPI"],
];
const unitExamples: Record<string, string> = {
  L: "Ex.: diesel, óleo, herbicida líquido",
  kg: "Ex.: ração, ureia, sementes a granel",
  g: "Ex.: aditivos e micronutrientes",
  mL: "Ex.: vacinas, adjuvantes",
  un: "Ex.: filtros, luvas, peças (só quantidades inteiras)",
  m: "Ex.: mangueira, arame, cerca",
};
type CatalogCategory = { id: string; name: string; archived: boolean };
function ProductForm({
  property,
  revision,
  product,
  products,
  close,
  done,
}: {
  property: PropertySummary;
  revision: number;
  product: ProductView | null;
  products: ProductView[];
  close: () => void;
  done: (s: string, thenRegister?: string) => Promise<void>;
}) {
  const [name, setName] = useState(product?.name || ""),
    [category, setCategory] = useState(product?.category || ""),
    [unit, setUnit] = useState(product?.unit || "L"),
    [minimum, setMinimum] = useState(
      product && Number(product.minimum) > 0 ? product.minimum : "",
    ),
    [ackKey, setAckKey] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [catalog, setCatalog] = useState<CatalogCategory[] | null>(null),
    [creating, setCreating] = useState(false),
    [newCategory, setNewCategory] = useState(""),
    [categoryBusy, setCategoryBusy] = useState(false);
  const isAdmin = property.role === "ADMIN";
  useEffect(() => {
    let active = true;
    apiRequest<CatalogCategory[]>(`/api/properties/${property.id}/categories`)
      .then((rows) => {
        if (active)
          setCatalog(
            rows
              .filter((c) => !c.archived || c.name === product?.category)
              .sort(
                (a, b) =>
                  Number(a.name === "Outros") - Number(b.name === "Outros"),
              ),
          );
      })
      .catch((e) => {
        if (active) {
          setCatalog([]);
          setError((e as Error).message);
        }
      });
    return () => {
      active = false;
    };
  }, [property.id, product]);
  const key = nameKeyOf(name),
    words = key.split(" ").filter((w) => w.length > 2),
    others = products.filter((p) => p.id !== product?.id),
    exact = key ? others.find((p) => nameKeyOf(p.name) === key) : undefined,
    similar =
      !product && !exact
        ? others
            .filter((p) => {
              const theirs = nameKeyOf(p.name).split(" ");
              return words.some((w) => theirs.includes(w));
            })
            .slice(0, 4)
        : [],
    acknowledged = ackKey === key,
    blocked = Boolean(exact) || (similar.length > 0 && !acknowledged),
    hinted = categoryHints.find(([re]) => re.test(key + " "))?.[1],
    suggestion = !category
      ? catalog?.find((c) => !c.archived && c.name === hinted)
      : undefined;
  async function addCategory() {
    const value = newCategory.trim();
    if (value.length < 2) {
      setError("Dê um nome de pelo menos 2 letras à categoria.");
      return;
    }
    setCategoryBusy(true);
    setError("");
    try {
      const existing = catalog?.find(
        (c) => nameKeyOf(c.name) === nameKeyOf(value),
      );
      if (existing && !existing.archived) setCategory(existing.name);
      else {
        const created = await apiRequest<{ id: string }>(
          `/api/properties/${property.id}/categories`,
          {
            key: crypto.randomUUID(),
            reason: "Criada ao cadastrar um produto no estoque",
            name: value,
          },
        );
        setCatalog((rows) => [
          ...(rows || []),
          { id: created.id, name: value, archived: false },
        ]);
        setCategory(value);
      }
      setCreating(false);
      setNewCategory("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCategoryBusy(false);
    }
  }
  async function save(thenRegister: boolean) {
    setError("");
    if (!category) {
      setError("Escolha uma categoria para o produto.");
      return;
    }
    const chosen = catalog?.find((c) => c.name === category);
    const clean = inputNumber(minimum);
    if (clean && (!Number.isFinite(Number(clean)) || Number(clean) < 0)) {
      setError("O estoque mínimo precisa ser um número maior ou igual a zero.");
      return;
    }
    setBusy(true);
    try {
      const saved = await apiRequest<{ id: string }>(
        `/api/properties/${property.id}/products${product ? `/${product.id}/update` : ""}`,
        {
          name,
          category,
          categoryId: chosen?.id,
          unit,
          minimum: clean || "0",
          minimumKnown: clean ? true : (product?.minimumKnown ?? true),
          acknowledgeSimilar: acknowledged,
          key: crypto.randomUUID(),
          revision,
        },
      );
      await done(
        product
          ? "Produto atualizado."
          : thenRegister
            ? "Produto cadastrado. Informe agora a quantidade que há em estoque."
            : "Produto cadastrado. Registre a quantidade inicial quando quiser.",
        thenRegister ? saved.id : undefined,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <StockDialog
      title={product ? "Editar produto" : "Novo produto"}
      close={close}
    >
      <form
        className="stock-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked) void save(!product);
        }}
      >
        <label>
          Nome do insumo
          <input
            required
            autoFocus
            minLength={2}
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Diesel S10"
          />
        </label>
        {exact && (
          <div className="stock-callout is-error" role="alert">
            <p>
              <strong>“{exact.name}” já está cadastrado.</strong> Para somar
              quantidade, registre uma entrada nele em vez de criar outro.
            </p>
            <Link
              href={`/app/estoque/${exact.id}`}
              className="stock-secondary"
              prefetch={false}
            >
              Abrir {exact.name}
            </Link>
          </div>
        )}
        {similar.length > 0 && (
          <div className="stock-callout" role="status">
            <p>
              <strong>
                {similar.length === 1
                  ? "Já existe um produto parecido:"
                  : "Já existem produtos parecidos:"}
              </strong>
            </p>
            <ul>
              {similar.map((p) => (
                <li key={p.id}>
                  <Link href={`/app/estoque/${p.id}`} prefetch={false}>
                    {p.name}
                  </Link>{" "}
                  <small>
                    · {number(p.balance)} {p.unit}
                  </small>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className={acknowledged ? "stock-secondary is-on" : "stock-secondary"}
              aria-pressed={acknowledged}
              onClick={() => setAckKey(acknowledged ? "" : key)}
            >
              {acknowledged ? (
                <>
                  <Check size={15} /> Certo, é outro produto
                </>
              ) : (
                "É outro produto, continuar"
              )}
            </button>
          </div>
        )}
        <fieldset className="stock-category-field">
          <legend>Categoria</legend>
          {!catalog ? (
            <span className="stock-help">Carregando categorias…</span>
          ) : (
            <div className="stock-chips" role="radiogroup" aria-label="Categoria">
              {catalog.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={category === c.name}
                  className={category === c.name ? "stock-chip is-on" : "stock-chip"}
                  onClick={() => setCategory(c.name)}
                >
                  {c.name}
                </button>
              ))}
              {isAdmin && !creating && (
                <button
                  type="button"
                  className="stock-chip is-add"
                  onClick={() => setCreating(true)}
                >
                  <Plus size={13} /> Nova categoria
                </button>
              )}
            </div>
          )}
          {suggestion && (
            <button
              type="button"
              className="stock-suggestion"
              onClick={() => setCategory(suggestion.name)}
            >
              Sugestão: usar “{suggestion.name}”
            </button>
          )}
          {creating && (
            <div className="stock-inline-add">
              <input
                autoFocus
                maxLength={80}
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addCategory();
                  }
                }}
                placeholder="Nome da nova categoria"
                aria-label="Nome da nova categoria"
              />
              <button
                type="button"
                className="stock-secondary"
                disabled={categoryBusy}
                onClick={() => void addCategory()}
              >
                {categoryBusy ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  "Criar"
                )}
              </button>
              <button
                type="button"
                className="stock-secondary"
                onClick={() => {
                  setCreating(false);
                  setNewCategory("");
                }}
              >
                Cancelar
              </button>
            </div>
          )}
          {catalog && !isAdmin && (
            <small className="stock-help">
              Precisa de outra categoria? Peça a um administrador da
              propriedade para criá-la em Configurações.
            </small>
          )}
        </fieldset>
        <div className="stock-form-grid">
          <label>
            <span>Unidade de medida</span>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              disabled={Boolean(product?.lots.length)}
            >
              {stockUnits.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
            <small>{unitExamples[unit]}</small>
          </label>
          <label>
            <span>
              Avisar quando faltar ({unit}) <small>· opcional</small>
            </span>
            <input
              inputMode="decimal"
              value={minimum}
              onChange={(e) => setMinimum(e.target.value)}
              maxLength={22}
              placeholder="Ex.: 200"
            />
            <small>Deixe vazio para não receber aviso.</small>
          </label>
        </div>
        <Feedback error={error} />
        <footer>
          <button
            type="button"
            className="stock-secondary"
            onClick={close}
            disabled={busy}
          >
            Cancelar
          </button>
          {product ? (
            <button className="button button-green" disabled={busy || blocked}>
              {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{" "}
              Salvar alterações
            </button>
          ) : (
            <>
              <button
                type="button"
                className="stock-secondary"
                disabled={busy || blocked}
                onClick={() => void save(false)}
              >
                Só cadastrar
              </button>
              <button className="button button-green" disabled={busy || blocked}>
                {busy ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />}{" "}
                Cadastrar e informar quantidade
              </button>
            </>
          )}
        </footer>
      </form>
    </StockDialog>
  );
}
function MovementForm({
  property,
  inventory,
  initialProduct,
  initialKind,
  close,
  done,
  reload,
}: {
  property: PropertySummary;
  inventory: InventoryView;
  initialProduct: string;
  initialKind: MovementInput["kind"];
  close: () => void;
  done: (s: string) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const [productId, setProductId] = useState(
      initialProduct || inventory.products.find((p) => !p.archived)?.id || "",
    ),
    [kind, setKind] = useState<MovementInput["kind"]>(initialKind),
    [lotId, setLotId] = useState("new"),
    [quantity, setQuantity] = useState(""),
    [date, setDate] = useState(localDay(property.timezone)),
    [destination, setDestination] = useState(""),
    [notes, setNotes] = useState("");
  const [code, setCode] = useState(""),
    [expiryStatus, setExpiryStatus] = useState<"UNKNOWN" | "DATED" | "NA">(
      "UNKNOWN",
    ),
    [expires, setExpires] = useState(""),
    [cost, setCost] = useState(""),
    [supplier, setSupplier] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<
      (MovementInput & { key: string; revision: number }) | null
    >(null);
  const p = inventory.products.find((p) => p.id === productId),
    outgoing = ["CONSUMPTION", "DISPOSAL", "ADJUST_OUT"].includes(kind),
    lot = p?.lots.find((l) => l.id === lotId);
  function chooseKind(value: MovementInput["kind"]) {
    setKind(value);
    if (["CONSUMPTION", "DISPOSAL", "ADJUST_OUT"].includes(value)) {
      const eligible = p?.lots.find(
        (l) =>
          Number(l.balance) > 0 &&
          (value !== "CONSUMPTION" || !l.expiresOn || l.expiresOn >= date),
      );
      setLotId(eligible?.id || "");
    } else setLotId("new");
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!pending) {
      if (!p) return;
      if (
        !Number.isFinite(Number(inputNumber(quantity))) ||
        Number(inputNumber(quantity)) <= 0
      ) {
        setError("Informe uma quantidade maior que zero.");
        return;
      }
      setPending({
        productId,
        kind,
        quantity: inputNumber(quantity),
        occurredAt: date,
        lotId: lotId !== "new" ? lotId : undefined,
        destination,
        notes,
        lot:
          lotId === "new"
            ? {
                code,
                expiryStatus,
                expiresOn: expiryStatus === "DATED" ? expires : undefined,
                unitCost: inputNumber(cost),
                supplier,
              }
            : undefined,
        key: crypto.randomUUID(),
        revision: inventory.revision,
      });
      return;
    }
    setBusy(true);
    try {
      await apiRequest(`/api/properties/${property.id}/movements`, pending);
      await done("Movimentação confirmada. Saldo e histórico atualizados.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <StockDialog title="Registrar movimentação" close={close}>
      <form className="stock-form" onSubmit={submit}>
        {pending ? (
          <div className="stock-review">
            <span className="stock-badge">CONFIRMAÇÃO DA MOVIMENTAÇÃO</span>
            <h3>{p?.name}</h3>
            <dl>
              <div>
                <dt>Operação</dt>
                <dd>{stockKinds[pending.kind]}</dd>
              </div>
              <div>
                <dt>Quantidade</dt>
                <dd>
                  {number(pending.quantity)} {p?.unit}
                </dd>
              </div>
              <div>
                <dt>Lote</dt>
                <dd>{lot?.code || pending.lot?.code}</dd>
              </div>
              <div>
                <dt>Data do fato</dt>
                <dd>{pending.occurredAt.split("-").reverse().join("/")}</dd>
              </div>
              <div>
                <dt>Saldo projetado do lote</dt>
                <dd>
                  {number(
                    (
                      Number(lot?.balance || 0) +
                      (outgoing ? -1 : 1) * Number(pending.quantity)
                    ).toFixed(3),
                  )}{" "}
                  {p?.unit}
                </dd>
              </div>
              {pending.destination && (
                <div>
                  <dt>Destino</dt>
                  <dd>{pending.destination}</dd>
                </div>
              )}
            </dl>
            {pending.notes && <p>Motivo / observação: {pending.notes}</p>}
            <p>
              O servidor verificará novamente permissão, saldo, validade e datas
              antes de gravar.
            </p>
          </div>
        ) : (
          <>
            <label>
              Produto
              <select
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  setLotId("new");
                  setKind("IN");
                }}
              >
                {inventory.products
                  .filter((p) => !p.archived)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {number(p.balance)} {p.unit}
                    </option>
                  ))}
              </select>
            </label>
            <div className="stock-form-grid">
              <label>
                Tipo de operação
                <select
                  value={kind}
                  onChange={(e) =>
                    chooseKind(e.target.value as MovementInput["kind"])
                  }
                >
                  {(
                    [
                      "OPENING",
                      "IN",
                      "CONSUMPTION",
                      "DISPOSAL",
                      ...(property.role === "ADMIN"
                        ? ["ADJUST_IN", "ADJUST_OUT"]
                        : []),
                    ] as MovementInput["kind"][]
                  ).map((k) => (
                    <option key={k} value={k}>
                      {stockKinds[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Quantidade ({p?.unit})
                <input
                  required
                  inputMode="decimal"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  maxLength={22}
                />
              </label>
            </div>
            <label>
              Lote
              <select
                required
                value={lotId}
                onChange={(e) => setLotId(e.target.value)}
              >
                {!outgoing && (
                  <option value="new">Cadastrar um novo lote</option>
                )}
                <option value="" disabled>
                  Selecione um lote
                </option>
                {p?.lots.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} · {number(l.balance)} {p.unit}
                    {l.expiresOn
                      ? ` · vence ${l.expiresOn.split("-").reverse().join("/")}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            {outgoing && (
              <p className="stock-help">
                Sugestão: lote elegível com vencimento mais próximo. Validade
                desconhecida exige conferência. Descarte não será contabilizado
                como consumo.
              </p>
            )}
            {lotId === "new" && (
              <fieldset className="stock-lot-fields">
                <legend>Dados do novo lote</legend>
                <label>
                  Código do lote
                  <input
                    required
                    maxLength={80}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Ex.: DIESEL-2026-01"
                  />
                </label>
                <div className="stock-form-grid">
                  <label>
                    Validade
                    <select
                      value={expiryStatus}
                      onChange={(e) =>
                        setExpiryStatus(e.target.value as typeof expiryStatus)
                      }
                    >
                      <option value="UNKNOWN">Não informada</option>
                      <option value="DATED">Informar data</option>
                      <option value="NA">Não se aplica</option>
                    </select>
                  </label>
                  {expiryStatus === "DATED" && (
                    <label>
                      Data de validade
                      <input
                        required
                        type="date"
                        value={expires}
                        onChange={(e) => setExpires(e.target.value)}
                      />
                    </label>
                  )}
                </div>
                <div className="stock-form-grid">
                  <label>
                    Custo unitário (R$) <small>opcional</small>
                    <input
                      inputMode="decimal"
                      maxLength={22}
                      value={cost}
                      onChange={(e) => setCost(e.target.value)}
                      placeholder="Não informado"
                    />
                  </label>
                  <label>
                    Fornecedor <small>opcional</small>
                    <input
                      maxLength={120}
                      value={supplier}
                      onChange={(e) => setSupplier(e.target.value)}
                    />
                  </label>
                </div>
                <p className="stock-help">
                  Custo em reais por {p?.unit}. Para preço de aquisição
                  diferente, cadastre outro lote.
                </p>
              </fieldset>
            )}
            <div className="stock-form-grid">
              <label>
                Data do fato
                <input
                  type="date"
                  required
                  value={date}
                  max={localDay(property.timezone)}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                Destino {kind === "CONSUMPTION" ? "" : "(opcional)"}
                <input
                  required={kind === "CONSUMPTION"}
                  value={destination}
                  maxLength={120}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="Ex.: Trator 01"
                />
              </label>
            </div>
            <label>
              Motivo / observação{" "}
              {["DISPOSAL", "ADJUST_IN", "ADJUST_OUT"].includes(kind)
                ? ""
                : "(opcional)"}
              <textarea
                required={["DISPOSAL", "ADJUST_IN", "ADJUST_OUT"].includes(
                  kind,
                )}
                value={notes}
                maxLength={500}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </label>
          </>
        )}
        <Feedback error={error} />
        {error.includes("mudou") && (
          <button
            className="stock-secondary"
            type="button"
            onClick={async () => {
              await reload();
              setPending(null);
              setError("");
            }}
          >
            Atualizar estoque e revisar
          </button>
        )}
        <footer>
          {pending && (
            <button
              className="stock-secondary"
              type="button"
              onClick={() => setPending(null)}
              disabled={busy}
            >
              Voltar para revisar
            </button>
          )}
          <button className="button button-green" disabled={busy}>
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : pending ? (
              <Check size={16} />
            ) : (
              <ArrowRight size={16} />
            )}{" "}
            {pending ? "Confirmar movimentação" : "Conferir movimentação"}
          </button>
        </footer>
      </form>
    </StockDialog>
  );
}
function ArchiveForm({
  property,
  product,
  revision,
  close,
  done,
}: {
  property: PropertySummary;
  product: ProductView;
  revision: number;
  close: () => void;
  done: (s: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  return (
    <StockDialog
      title={product.archived ? "Reativar produto" : "Arquivar produto"}
      close={close}
    >
      <form
        className="stock-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await apiRequest(
              `/api/properties/${property.id}/products/${product.id}/archive`,
              { key: key.current, revision, archived: !product.archived },
            );
            await done(
              product.archived
                ? "Produto reativado."
                : "Produto arquivado. O histórico foi preservado.",
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          {product.name}:{" "}
          {product.archived
            ? "o cadastro voltará à lista de produtos ativos."
            : "o cadastro sairá da lista ativa. Só é possível arquivar produtos sem saldo; nenhum movimento será apagado."}
        </p>
        <Feedback error={error} />
        <footer>
          <button type="button" className="stock-secondary" onClick={close}>
            Cancelar
          </button>
          <button className="button button-green" disabled={busy}>
            Confirmar {product.archived ? "reativação" : "arquivamento"}
          </button>
        </footer>
      </form>
    </StockDialog>
  );
}
function History({
  property,
  revision,
  products,
  productId,
  refresh,
  defaultFilters,
}: {
  property: PropertySummary;
  revision: number;
  products: ProductView[];
  productId?: string;
  refresh: () => Promise<void>;
  defaultFilters?: { kind?: string; from?: string; to?: string };
}) {
  const [rows, setRows] = useState<MovementView[] | null>(null),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [filterProduct, setFilterProduct] = useState(productId || ""),
    [kind, setKind] = useState(defaultFilters?.kind || ""),
    [from, setFrom] = useState(defaultFilters?.from || ""),
    [to, setTo] = useState(defaultFilters?.to || ""),
    [error, setError] = useState(""),
    [reverse, setReverse] = useState<MovementView | null>(null),
    [notes, setNotes] = useState(""),
    [busy, setBusy] = useState(false),
    [reverseError, setReverseError] = useState("");
  const key = useRef("");
  const latestHistory = useRef(0);
  const reload = useCallback(async () => {
    const requestId = ++latestHistory.current;
    setError("");
    const q = new URLSearchParams({ page: String(page) });
    if (filterProduct) q.set("productId", filterProduct);
    if (kind) q.set("kind", kind);
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    try {
      const result = await apiRequest<{ rows: MovementView[]; total: number }>(
        `/api/properties/${property.id}/movements?${q}`,
      );
      if (requestId === latestHistory.current) {
        setRows(result.rows);
        setTotal(result.total);
      }
    } catch (e) {
      if (requestId === latestHistory.current) setError((e as Error).message);
    }
  }, [property.id, page, filterProduct, kind, from, to]);
  useEffect(() => {
    void reload();
  }, [reload, revision]);
  return (
    <section className="stock-card">
      <div className="stock-card-heading">
        <div>
          <h2>Histórico de movimentações</h2>
          <p>Perdas, ajustes e estornos ficam separados do consumo.</p>
        </div>
        <span className="stock-badge">{total} registros</span>
      </div>
      <div className="stock-history-filters">
        {!productId && (
          <label>
            Produto
            <select
              value={filterProduct}
              onChange={(e) => {
                setFilterProduct(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos os produtos</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Operação
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todas</option>
            {Object.entries(stockKinds).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          De
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Até
          <input
            type="date"
            value={to}
            max={localDay(property.timezone)}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      <Feedback error={error} />
      {!rows ? (
        <Pending />
      ) : !rows.length ? (
        <div className="stock-empty-small">
          Nenhuma movimentação neste período.
        </div>
      ) : (
        <div
          className="stock-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Histórico de movimentações"
        >
          <table>
            <thead>
              <tr>
                <th>Data / responsável</th>
                <th>Produto / lote</th>
                <th>Operação</th>
                <th>Quantidade</th>
                <th>Destino / motivo</th>
                <th>Origem</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {new Intl.DateTimeFormat("pt-BR", {
                      timeZone: property.timezone,
                    }).format(new Date(r.occurredAt))}
                    <small>{r.actorName}</small>
                    {r.originalResponsible && <small>Responsável na origem: {r.originalResponsible}</small>}
                    {r.originalLine && <small>Registro de origem: linha {r.originalLine}{r.originalReference ? ` · ${r.originalReference}` : ""}</small>}
                    <small>
                      Registrado{" "}
                      {new Intl.DateTimeFormat("pt-BR", {
                        timeZone: property.timezone,
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(r.recordedAt))}
                    </small>
                  </td>
                  <td>
                    <Link href={`/app/estoque/${r.productId}`}>
                      <strong>{r.productName}</strong>
                    </Link>
                    <small>{r.lotCode}</small>
                  </td>
                  <td>
                    <span className="stock-badge">{stockKinds[r.kind]}</span>
                    {r.kind === "CONSUMPTION" && !r.consumptionConfirmed && <small>Saída sem natureza de uso confirmada · fora da média</small>}
                    {r.reversed && <small>Estornado</small>}
                  </td>
                  <td
                    className={Number(r.delta) < 0 ? "stock-out" : "stock-in"}
                  >
                    {Number(r.delta) > 0 ? "+" : ""}
                    {number(r.delta)} {r.unit}
                  </td>
                  <td>
                    {r.destination || "—"}
                    {r.notes && <small>{r.notes}</small>}
                  </td>
                  <td>{r.source === "IMPORT" ? "Planilha" : "Painel"}</td>
                  <td>
                    {property.role !== "VIEWER" && r.kind === "CONSUMPTION" && !r.consumptionConfirmed && !r.reversed && <ClassifyMovement property={property} movement={r} refresh={async () => { await reload(); await refresh(); }} />}
                    {property.role === "ADMIN" &&
                    r.kind !== "REVERSAL" &&
                    !r.reversed ? (
                      <button
                        className="stock-text-button"
                        onClick={() => {
                          key.current = crypto.randomUUID();
                          setNotes("");
                          setReverseError("");
                          setReverse(r);
                        }}
                      >
                        Estornar
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="stock-pagination">
        <button
          className="stock-secondary"
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Anterior
        </button>
        <span>
          Página {page} de {Math.max(1, Math.ceil(total / 50))}
        </span>
        <button
          className="stock-secondary"
          disabled={page * 50 >= total}
          onClick={() => setPage((p) => p + 1)}
        >
          Próxima
        </button>
      </div>
      {reverse && (
        <StockDialog
          title="Estornar movimentação"
          close={() => setReverse(null)}
        >
          <form
            className="stock-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await apiRequest(
                  `/api/properties/${property.id}/movements/${reverse.id}/reverse`,
                  { key: key.current, revision, notes },
                );
                setReverse(null);
                await refresh();
              } catch (e) {
                setReverseError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="stock-review">
              <h3>
                {reverse.productName} · {reverse.lotCode}
              </h3>
              <p>
                {stockKinds[reverse.kind]} de{" "}
                {number(Math.abs(Number(reverse.delta)))} {reverse.unit}. O
                estorno registrará o efeito inverso na data atual e preservará o
                original.
              </p>
            </div>
            <label>
              Motivo do estorno
              <textarea
                required
                minLength={3}
                maxLength={500}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </label>
            <Feedback error={reverseError} />
            <footer>
              <button
                className="stock-secondary"
                type="button"
                onClick={() => setReverse(null)}
              >
                Cancelar
              </button>
              <button className="button button-green" disabled={busy}>
                Confirmar estorno
              </button>
            </footer>
          </form>
        </StockDialog>
      )}
    </section>
  );
}

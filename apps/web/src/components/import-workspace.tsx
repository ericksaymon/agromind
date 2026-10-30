"use client";
import { Select } from "./select";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  FileSpreadsheet,
  LoaderCircle,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { apiRequest } from "@/lib/auth-client";
import {
  Feedback,
  localDay,
  number,
  Pending,
  StockDialog,
} from "@/components/stock-workspace";
import {
  importFields,
  stockKinds,
  type StockKind,
  type ImportField,
  type ImportRow,
  type ImportView,
  type InventoryView,
  type PropertySummary,
} from "../../../../packages/contracts/src/index";
import { ImportReconciliation } from "./import-reconciliation";
const fields = Object.keys(importFields) as ImportField[];
const fieldCopy: Record<ImportField, { label: string; help: string }> = {
  product: { label: "Nome do produto", help: "Como o insumo se chama (ex.: Calcário dolomítico)." },
  quantity: { label: "Quantidade", help: "Quanto você tem ou quanto foi movimentado, só o número." },
  unit: { label: "Unidade de medida", help: "kg, g, L, mL, un ou m. Outras unidades precisam ser convertidas na planilha." },
  category: { label: "Categoria", help: "O grupo do produto (ex.: Corretivos). Precisa já existir no sistema; sem coluna, usamos “Outros”." },
  minimum: { label: "Estoque mínimo", help: "Abaixo dessa quantidade o sistema avisa que é hora de repor." },
  unitCost: { label: "Custo por unidade (R$)", help: "Quanto custa 1 unidade, em reais. Permite calcular o valor parado em estoque." },
  lot: { label: "Código do lote", help: "Número impresso na embalagem. Sem coluna, usamos “SEM-LOTE”." },
  expiry: { label: "Data de validade", help: "DD/MM/AAAA ou AAAA-MM-DD. Escreva N/A se o produto não vence." },
  supplier: { label: "Fornecedor", help: "De quem você comprou." },
  kind: { label: "Tipo de movimento", help: "Entrada, saída, abertura (saldo inicial) ou ajuste." },
  date: { label: "Data da movimentação", help: "O dia em que aconteceu de verdade, não o dia do cadastro." },
  destination: { label: "Destino de uso", help: "Onde foi aplicado ou para onde foi (talhão, máquina, outra unidade)." },
  notes: { label: "Observações", help: "Qualquer texto livre; é só guardado junto do registro." },
  reference: { label: "Código de referência", help: "Número da nota, pedido ou registro no sistema antigo. Ajuda a rastrear e evita importar duas vezes." },
  responsible: { label: "Quem fez a movimentação", help: "Nome da pessoa que registrou ou executou na época." },
  usageConfirmed: { label: "Essa saída foi consumo? (sim/não)", help: "Uma saída pode ser uso, perda ou venda. Só contam como consumo (base do cálculo de autonomia) as linhas com “sim”, “uso” ou “consumo”." },
};
// Infere o formato numérico pelos valores reais das colunas numéricas associadas.
// Devolve null quando não há evidência (ex.: só inteiros).
function detectLocale(
  sheet: { rows: string[][] } | undefined,
  mapping: Partial<Record<ImportField, number>>,
): "BR" | "DOT" | null {
  if (!sheet) return null;
  const cols = (["quantity", "minimum", "unitCost"] as ImportField[])
    .map((f) => mapping[f])
    .filter((i): i is number => i !== undefined);
  let br = false,
    dot = false,
    groupedOnly = false;
  for (const row of sheet.rows) {
    for (const i of cols) {
      const v = (row[i] || "").trim();
      if (/,\d{1,4}$/.test(v)) br = true;
      else if (/^\d+\.\d+$/.test(v)) {
        if (/^\d{1,3}(\.\d{3})+$/.test(v) && !/^0\./.test(v)) groupedOnly = true;
        else dot = true;
      }
    }
  }
  if (br && !dot) return "BR";
  if (dot && !br) return "DOT";
  if (!br && !dot && groupedOnly) return "BR";
  return null;
}
const optionalGroups: { title: string; fields: ImportField[] }[] = [
  { title: "Sobre o produto", fields: ["category", "minimum", "unitCost"] },
  { title: "Sobre o lote", fields: ["lot", "expiry", "supplier"] },
  { title: "Sobre cada movimentação", fields: ["kind", "date", "destination", "responsible", "reference", "notes", "usageConfirmed"] },
];
type BatchList = {
  id: string;
  fileName: string;
  status: string;
  mode: string;
  createdAt: string;
  result: { imported: number; ignored: number } | null;
}[];
export function ImportWorkspace({ property }: { property: PropertySummary }) {
  const base = `/api/properties/${property.id}`;
  const fileInput = useRef<HTMLInputElement>(null);
  const [batch, setBatch] = useState<ImportView | null>(null),
    [batches, setBatches] = useState<BatchList>([]),
    [inventory, setInventory] = useState<InventoryView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [mode, setMode] = useState<"POSITION" | "HISTORY">("POSITION");
  const [step, setStep] = useState(1),
    [sheet, setSheet] = useState(0),
    [mapping, setMapping] = useState<Partial<Record<ImportField, number>>>({}),
    [locale, setLocale] = useState<"BR" | "DOT">("BR"),
    [positionDate, setPositionDate] = useState(localDay(property.timezone)),
    [selected, setSelected] = useState<number[]>([]),
    [ack, setAck] = useState(false),
    [allowDuplicates, setAllowDuplicates] = useState(false),
    [confirm, setConfirm] = useState(false),
    [cancel, setCancel] = useState(false),
    [page, setPage] = useState(1),
    [editing, setEditing] = useState<ImportRow | null>(null),
    [edits, setEdits] = useState<
      {
        line: number;
        values: Partial<Record<ImportField, string>>;
        productId?: string | null;
      }[]
    >([]),
    [dirty, setDirty] = useState(false),
    [aiNote, setAiNote] = useState(""),
    [localeAuto, setLocaleAuto] = useState(false);
  const write = property.role !== "VIEWER";
  const load = useCallback(async () => {
    try {
      const [inv, list] = await Promise.all([
        apiRequest<InventoryView>(`${base}/inventory`),
        apiRequest<{ batches: BatchList }>(`${base}/imports`),
      ]);
      setInventory(inv);
      setBatches(list.batches);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);
  async function upload(e?: React.FormEvent, forcedMode?: "POSITION" | "HISTORY") {
    e?.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > 1000000)
        throw new Error("Escolha um arquivo de até 1 MB.");
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () =>
          reject(new Error("Não foi possível ler este arquivo."));
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.readAsDataURL(file);
      });
      const draft = await apiRequest<ImportView>(`${base}/imports`, {
        fileName: file.name,
        content,
        mode: forcedMode ?? mode,
      });
      setBatch(draft);
      setMapping(draft.mapping);
      const found = detectLocale(draft.sheets[0], draft.mapping);
      setLocaleAuto(found !== null);
      if (found) setLocale(found);
      setStep(2);
      setSheet(0);
      setEdits([]);
      setAiNote("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function resume(id: string) {
    setBusy(true);
    setError("");
    try {
      const draft = await apiRequest<ImportView>(`${base}/imports/${id}`);
      setBatch(draft);
      setMapping(draft.mapping);
      const found = detectLocale(draft.sheets[0], draft.mapping);
      setLocaleAuto(found !== null);
      if (found) setLocale(found);
      setMode(draft.mode);
      setEdits([]);
      setSheet(0);
      setStep(draft.status === "CONFIRMED" ? 4 : 2);
      setDirty(Boolean(draft.rows.length));
      setSelected([]);
      setAck(false);
      setAiNote(draft.analysisNote || "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function preview(nextEdits = edits) {
    if (!batch) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<ImportView>(
        `${base}/imports/${batch.id}/preview`,
        { sheet, mapping, locale, positionDate, edits: nextEdits },
      );
      setBatch(result);
      setSelected(
        result.rows
          .filter((r) => !r.errors.length && !r.duplicate)
          .map((r) => r.line),
      );
      setAck(false);
      setAllowDuplicates(false);
      setStep(3);
      setDirty(false);
      setPage(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function analyze() {
    if (!batch) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{
        mapping: Partial<Record<ImportField, number>>;
        note: string;
        model: string;
      }>(`${base}/imports/${batch.id}/analyze`, { sheet, consent: true });
      setMapping(result.mapping);
      const found = detectLocale(batch.sheets[sheet], result.mapping);
      setLocaleAuto(found !== null);
      if (found) setLocale(found);
      setAiNote(
        `Sugestão de ${result.model}. ${result.note || "Confira cada associação antes de continuar."}`,
      );
      setDirty(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function finish() {
    if (!batch?.previewToken) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ result: ImportView["result"] }>(
        `${base}/imports/${batch.id}/confirm`,
        {
          previewToken: batch.previewToken,
          lines: selected,
          acknowledgeWarnings: ack,
          allowDuplicates,
        },
      );
      setBatch({ ...batch, status: "CONFIRMED", result: result.result });
      setConfirm(false);
      setStep(4);
      await load();
    } catch (e) {
      setConfirm(false);
      setError((e as Error).message);
      if ((e as { code?: string }).code === "STALE_PREVIEW") setDirty(true);
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setBatch(null);
    setStep(1);
    setFile(null);
    setError("");
    setEdits([]);
    setSelected([]);
    setAck(false);
    setConfirm(false);
    setCancel(false);
    setDirty(false);
    setAiNote("");
    setPage(1);
  }
  const rows = batch?.rows || [],
    shown = rows.slice((page - 1) * 20, page * 20),
    invalid = rows.filter((r) => r.errors.length).length;
  return (
    <div className="stock-workspace">
      <div className="stock-page-heading">
        <div>
          <span className="eyebrow section-label">DADOS QUE VOCÊ JÁ TEM</span>
          <h1>Importar estoque</h1>
          <p>
            Traga sua planilha, confira os dados e confirme o que vai entrar.
          </p>
        </div>
        <Link href="/app/estoque" className="stock-secondary">
          <PackageIcon />
          Ver meus insumos
        </Link>
      </div>
      <ol className="import-progress" aria-label="Etapas da importação">
        {["Enviar planilha", "Associar colunas", "Conferir e importar"].map(
          (label, i) => (
            <li
              key={label}
              aria-current={step === i + 1 ? "step" : undefined}
              className={step >= i + 1 ? "current" : ""}
            >
              <span>{step > i + 1 ? <Check size={13} /> : i + 1}</span>
              {label}
            </li>
          ),
        )}
      </ol>
      <Feedback error={error} />
      {!write && (
        <p className="stock-inline-note">
          Seu acesso permite consultar o histórico. Para importar, solicite
          acesso de operador ou administrador.
        </p>
      )}
      {step === 1 && (
        <div className="import-start-grid">
          <section className="stock-card import-upload">
            <div className="stock-card-heading">
              <div>
                <h2>1. Escolha o tipo de planilha</h2>
                <p>
                  Você não precisa enviar as duas. Comece pela posição de
                  estoque e, se tiver o histórico, envie-o depois.
                </p>
              </div>
            </div>
            <form className="stock-form" onSubmit={upload}>
              <fieldset className="import-mode-options">
                <legend>Qual planilha você tem em mãos?</legend>
                <label className={mode === "POSITION" ? "is-active" : ""}>
                  <input
                    type="radio"
                    name="import-mode"
                    checked={mode === "POSITION"}
                    onChange={() => setMode("POSITION")}
                  />
                  <span>
                    <em>Para começar</em>
                    <strong>Posição de estoque</strong>
                    <small>
                      A lista do que você tem hoje: produto, quantidade e
                      unidade. É a planilha mais simples e já preenche o painel.
                    </small>
                  </span>
                </label>
                <label className={mode === "HISTORY" ? "is-active" : ""}>
                  <input
                    type="radio"
                    name="import-mode"
                    checked={mode === "HISTORY"}
                    onChange={() => setMode("HISTORY")}
                  />
                  <span>
                    <em>Opcional</em>
                    <strong>Histórico de movimentações</strong>
                    <small>
                      Entradas, consumo e descartes com data. Permite calcular o
                      consumo médio e a autonomia de cada insumo.
                    </small>
                  </span>
                </label>
              </fieldset>
              <div className={`import-file-card${file ? " is-selected" : ""}`}>
                <input
                  ref={fileInput}
                  id="import-spreadsheet-file"
                  className="import-file-control"
                  aria-label="Arquivo da planilha"
                  type="file"
                  accept=".csv,.xlsx"
                  required
                  disabled={!write || busy}
                  onChange={(e) => {
                    const next = e.target.files?.[0];
                    if (next) { setFile(next); setError(""); }
                  }}
                />
                {file ? <>
                  <span className="import-file-icon" aria-hidden="true"><FileSpreadsheet size={27} /></span>
                  <div className="import-file-copy" role="status">
                    <span className="import-file-status"><Check size={13} aria-hidden="true" /> Arquivo selecionado</span>
                    <strong>{file.name}</strong>
                    <small>{file.name.split(".").pop()?.toUpperCase()} · {new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(file.size / 1000)} KB</small>
                    <p>{file.size > 1000000 ? "O arquivo excede 1 MB. Escolha uma planilha menor." : "Pronto para leitura. Você confere os dados antes de importar."}</p>
                  </div>
                  <div className="import-file-actions">
                    <label htmlFor="import-spreadsheet-file" aria-disabled={!write || busy}>Trocar arquivo</label>
                    <button type="button" aria-label="Remover arquivo selecionado" disabled={!write || busy} onClick={() => {
                      setFile(null); setError("");
                      if (fileInput.current) { fileInput.current.value = ""; fileInput.current.focus(); }
                    }}><X size={17} aria-hidden="true" /></button>
                  </div>
                </> : <label className="import-file-input" htmlFor="import-spreadsheet-file" aria-disabled={!write || busy}>
                  <Upload size={27} aria-hidden="true" />
                  <strong>Selecione sua planilha</strong>
                  <span>CSV UTF-8 ou XLSX · até 1 MB, 1.000 registros e 32 colunas</span>
                  <span className="import-file-choose">Escolher arquivo</span>
                </label>}
              </div>
              <p className="stock-help">
                Use cabeçalhos na primeira linha. Fórmulas devem ser
                substituídas por valores. Nenhum dado de estoque é gravado ao
                enviar o arquivo.
              </p>
              <footer>
                <button
                  className="button button-green"
                  disabled={busy || !write || !file || file.size > 1000000}
                >
                  {busy ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <ArrowRight size={16} />
                  )}
                  Ler planilha
                </button>
              </footer>
            </form>
          </section>
          <aside className="stock-card import-guide">
            <span className="import-guide-icon">
              <FileSpreadsheet size={28} />
            </span>
            <h2>Como funciona</h2>
            <ol className="import-how">
              <li>
                <strong>Você envia</strong> um arquivo CSV ou XLSX.
              </li>
              <li>
                <strong>A IA sugere</strong> a que coluna corresponde cada
                dado. Só os títulos das colunas são lidos por ela.
              </li>
              <li>
                <strong>Você confere</strong> cada linha. Nada entra no estoque
                antes da sua confirmação.
              </li>
            </ol>
            <div className="import-guide-note">
              Os alertas e a autonomia são calculados por regras fixas sobre os
              seus registros, sem IA. Dados que faltam, como custo ou validade,
              ficam como não informados.
            </div>
            <p className="import-guide-label">Sem planilha pronta? Baixe um modelo:</p>
            <a className="stock-secondary" href="/modelo-estoque.csv" download>
              Modelo de posição de estoque <ArrowRight size={15} />
            </a>
            <a
              className="stock-secondary"
              href="/modelo-movimentacoes.csv"
              download
            >
              Modelo de histórico <ArrowRight size={15} />
            </a>
          </aside>
        </div>
      )}
      {batch && step === 2 && (
        <section className="stock-card">
          <div className="stock-card-heading">
            <div>
              <h2>2. Associe as colunas da planilha</h2>
              <p>
                {batch.fileName} ·{" "}
                {batch.mode === "POSITION"
                  ? "Posição de estoque"
                  : "Histórico de movimentações"}
              </p>
              <p>
                Diga ao sistema qual coluna da sua planilha corresponde a cada
                informação. Já preenchemos o que reconhecemos: normalmente basta
                conferir os exemplos e seguir.
              </p>
            </div>
            <button
              className="stock-text-button"
              disabled={busy}
              onClick={() => setCancel(true)}
            >
              Cancelar rascunho
            </button>
          </div>
          {batch.fileRepeated && (
            <div className="stock-warning">
              Este arquivo já foi importado. Confira as duplicidades antes de
              continuar.
            </div>
          )}
          <div className="stock-form">
            {batch.mode === "POSITION" &&
              mapping.kind !== undefined &&
              mapping.date !== undefined && (
                <div className="stock-warning import-mode-hint" role="status">
                  <strong>Esta planilha parece um histórico de movimentações.</strong>{" "}
                  Ela tem colunas de tipo e de data por linha, mas foi enviada
                  como “Posição de estoque”: nesse modo o tipo e a data de cada
                  linha são ignorados e todas viram saldo inicial.
                  {file ? (
                    <button
                      type="button"
                      className="stock-secondary"
                      disabled={busy}
                      onClick={async () => {
                        try {
                          await apiRequest(`${base}/imports/${batch.id}/cancel`, {});
                        } catch {
                          /* rascunho antigo expira sozinho em 24 h */
                        }
                        setMode("HISTORY");
                        void upload(undefined, "HISTORY");
                      }}
                    >
                      Reenviar como histórico
                    </button>
                  ) : (
                    " Cancele o rascunho e envie de novo escolhendo “Histórico de movimentações”."
                  )}
                </div>
              )}
            <div className="stock-form-grid">
              <label>
                Aba da planilha
                <Select
                  value={sheet}
                  onChange={(e) => {
                    setSheet(Number(e.target.value));
                    setMapping({});
                    setEdits([]);
                    setDirty(true);
                    setAiNote("");
                  }}
                >
                  {batch.sheets.map((s, i) => (
                    <option key={s.name} value={i}>
                      {s.name} · {s.rows.length} registros
                    </option>
                  ))}
                </Select>
              </label>
              <label>
                Formato dos números
                <Select
                  value={locale}
                  onChange={(e) => {
                    setLocale(e.target.value as typeof locale);
                    setLocaleAuto(false);
                    setEdits([]);
                    setDirty(true);
                  }}
                >
                  <option value="BR">Brasileiro: 1.250,50</option>
                  <option value="DOT">Ponto decimal: 1250.50</option>
                </Select>
                {localeAuto && (
                  <small className="import-field-example">
                    Detectado automaticamente pelos números da sua planilha.
                  </small>
                )}
              </label>
              {batch.mode === "POSITION" && (
                <label>
                  Data desta posição de estoque
                  <input
                    type="date"
                    required
                    max={localDay(property.timezone)}
                    value={positionDate}
                    onChange={(e) => {
                      setPositionDate(e.target.value);
                      setDirty(true);
                    }}
                  />
                </label>
              )}
            </div>
            <div className="import-ai-box">
              <Sparkles size={20} />
              <div>
                <h3>Sugestão automática das colunas</h3>
                <p>
                  {batch.aiAvailable
                    ? "A IA lê apenas os títulos das colunas (nunca as linhas ou quantidades) e sugere a associação. Você confere antes de seguir."
                    : "A análise por IA aguarda configuração do OpenRouter. Você pode continuar manualmente."}
                </p>
                {aiNote && (
                  <p className="stock-ai-note" role="status">
                    {aiNote}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="stock-secondary"
                disabled={busy || !batch.aiAvailable || !write}
                onClick={() => {
                  void analyze();
                }}
              >
                Sugerir com IA
              </button>
            </div>
            {(() => {
              const required: ImportField[] = ["product", "quantity", "unit", ...(batch.mode === "HISTORY" ? (["kind", "date"] as ImportField[]) : [])];
              const field = (f: ImportField) => (
                <label key={f}>
                  <span>
                    {fieldCopy[f].label}
                    {required.includes(f) && <small> obrigatório</small>}
                  </span>
                  <small className="import-field-help">{fieldCopy[f].help}</small>
                  <Select
                    value={mapping[f] ?? ""}
                    onChange={(e) => {
                      const next = {
                        ...mapping,
                        [f]: e.target.value === "" ? undefined : Number(e.target.value),
                      };
                      setMapping(next);
                      const found = detectLocale(batch.sheets[sheet], next);
                      if (found && found !== locale) {
                        setLocale(found);
                        setLocaleAuto(true);
                      }
                      setEdits([]);
                      setDirty(true);
                    }}
                  >
                    <option value="">Não informado</option>
                    {batch.sheets[sheet]?.headers.map((header, index) => (
                      <option key={index} value={index}>
                        {index + 1}. {header}
                      </option>
                    ))}
                  </Select>
                  <small className="import-field-example">
                    {mapping[f] !== undefined
                      ? `Na sua planilha, 1ª linha: ${batch.sheets[sheet]?.rows[0]?.[mapping[f]!] || "(vazio)"}`
                      : required.includes(f)
                        ? "Escolha a coluna correspondente para continuar."
                        : "Sem coluna: ficará como não informado. Você pode corrigir na prévia."}
                  </small>
                </label>
              );
              // Em posição de estoque, tipo/data/uso são definidos pelo sistema.
              const hiddenInPosition: ImportField[] = ["kind", "date", "usageConfirmed"];
              const groups = optionalGroups
                .map((g) => ({
                  ...g,
                  fields: g.fields.filter(
                    (f) =>
                      !required.includes(f) &&
                      !(batch.mode === "POSITION" && hiddenInPosition.includes(f)),
                  ),
                }))
                .filter((g) => g.fields.length);
              const optional = groups.flatMap((g) => g.fields);
              const filled = optional.filter((f) => mapping[f] !== undefined).length;
              const missing = required.filter((f) => mapping[f] === undefined);
              return (
                <>
                  <p
                    className={`import-required-status${missing.length ? " is-missing" : ""}`}
                    role="status"
                  >
                    {missing.length
                      ? `Falta associar: ${missing.map((f) => fieldCopy[f].label).join(", ")}.`
                      : `Tudo certo: os ${required.length} campos obrigatórios estão associados. Confira os exemplos e siga em frente.`}
                  </p>
                  <h3 className="import-group-title">Informações obrigatórias</h3>
                  <div className="import-mapping">{required.map(field)}</div>
                  <details className="import-optional" open={filled > 0 || missing.length === 0}>
                    <summary>
                      Informações extras (opcionais) · {filled} de {optional.length} associadas
                    </summary>
                    {groups.map((g) => (
                      <section key={g.title} className="import-group">
                        <h3 className="import-group-title">{g.title}</h3>
                        <div className="import-mapping">{g.fields.map(field)}</div>
                      </section>
                    ))}
                  </details>
                </>
              );
            })()}
            <p className="stock-help">
              {batch.mode === "POSITION"
                ? "Cada linha vira o saldo inicial de um lote, na data informada acima. Se um produto já tem movimentações no sistema, ajuste o saldo pela conciliação na próxima etapa. Custos sempre em reais por unidade."
                : "Cada linha vira uma movimentação datada. Tipo e data são obrigatórios. Custos sempre em reais por unidade; converta outras moedas antes de enviar."}{" "}
              Nada é gravado até você confirmar na próxima etapa.
            </p>
            <footer>
              <button
                type="button"
                className="button button-green"
                disabled={
                  busy ||
                  !write ||
                  ["product", "quantity", "unit", ...(batch.mode === "HISTORY" ? ["kind", "date"] : [])].some(
                    (f) => mapping[f as ImportField] === undefined,
                  )
                }
                onClick={() => {
                  void preview();
                }}
              >
                {busy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <ArrowRight size={16} />
                )}
                Gerar prévia para conferência
              </button>
            </footer>
          </div>
        </section>
      )}
      {batch && step === 3 && (
        <section className="stock-card">
          <div className="stock-card-heading">
            <div>
              <h2>3. Confira o que será importado</h2>
              <p>
                {rows.length} registros · {rows.length - invalid} sem erro de
                campo · {invalid} com pendência
              </p>
            </div>
            <button
              className="stock-secondary"
              disabled={busy}
              onClick={() => setStep(2)}
            >
              <ArrowLeft size={15} />
              Rever colunas
            </button>
          </div>
          <div className="stock-warning">
            A confirmação importa somente os registros selecionados. O conjunto
            precisa ter saldo e sequência de datas válidos; nenhum registro será
            gravado se a confirmação falhar.
          </div>
          {dirty && (
            <p className="stock-warning">
              O estoque ou a prévia mudou. Gere a prévia novamente para conferir
              os saldos atuais.
            </p>
          )}
          {inventory && <ImportReconciliation key={batch.previewToken} batch={batch} inventory={inventory} selected={selected} />}
          <div className="import-selection">
            <button
              className="stock-secondary"
              onClick={() =>
                setSelected(
                  rows
                    .filter((r) => !r.errors.length && !r.duplicate)
                    .map((r) => r.line),
                )
              }
            >
              <CheckCheck size={16} />
              Selecionar válidos sem duplicidade
            </button>
            <button
              className="stock-text-button"
              onClick={() => setSelected([])}
            >
              Desmarcar todos
            </button>
            <span>{selected.length} selecionados</span>
          </div>
          <div
            className="stock-table-scroll"
            role="region"
            aria-label="Prévia da importação"
            tabIndex={0}
          >
            <table className="import-preview-table">
              <thead>
                <tr>
                  <th>Importar</th>
                  <th>Produto / associação</th>
                  <th>Quantidade / operação</th>
                  <th>Lote / validade</th>
                  <th>Conferência</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr
                    key={row.line}
                    className={row.errors.length ? "import-invalid" : ""}
                  >
                    <td>
                      <label className="stock-checkbox">
                        <input
                          type="checkbox"
                          aria-label={`Importar registro ${row.line}`}
                          disabled={row.errors.length > 0}
                          checked={selected.includes(row.line)}
                          onChange={(e) => {
                            setAck(false);
                            setSelected(
                              e.target.checked
                                ? [...selected, row.line]
                                : selected.filter((l) => l !== row.line),
                            );
                          }}
                        />
                        <span>#{row.line}</span>
                      </label>
                    </td>
                    <td>
                      <strong>{row.values.product || "Produto ausente"}</strong>
                      <small>
                        {row.productId
                          ? `Vincular: ${inventory?.products.find((p) => p.id === row.productId)?.name || "produto existente"}`
                          : "Criar produto"}
                      </small>
                      <small>{row.values.category}</small>
                    </td>
                    <td>
                      <strong>
                        {row.values.quantity} {row.values.unit}
                      </strong>
                      <small>
                        {stockKinds[row.values.kind as StockKind] ||
                          row.values.kind}{" "}
                        · {row.values.date.split("-").reverse().join("/")}
                      </small>
                      {!row.errors.length && <small>{Number(row.values.quantity) === 0 ? "Sem movimento de abertura" : `${["CONSUMPTION", "DISPOSAL"].includes(row.values.kind) ? "Reduz" : "Acrescenta"} ${number(row.values.quantity)} ${row.values.unit} ao saldo`}</small>}
                    </td>
                    <td>
                      {row.values.lot || "SEM-LOTE"}
                      <small>
                        {row.values.expiry || "Validade não informada"}
                      </small>
                    </td>
                    <td>
                      {row.errors.length ? (
                        <>
                          <span className="stock-badge danger">Corrigir</span>
                          {row.errors.map((e) => (
                            <small key={e}>{e}</small>
                          ))}
                        </>
                      ) : (
                        <span
                          className={`stock-badge ${row.duplicate ? "warn" : ""}`}
                        >
                          {row.duplicate ? "Possível duplicidade" : "Pronto"}
                        </span>
                      )}
                      {row.warnings.map((w) => (
                        <small key={w}>{w}</small>
                      ))}
                    </td>
                    <td>
                      <button
                        className="stock-text-button"
                        disabled={busy}
                        onClick={() => setEditing(row)}
                      >
                        Revisar registro
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="stock-pagination">
            <button
              className="stock-secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </button>
            <span>
              Página {page} de {Math.max(1, Math.ceil(rows.length / 20))}
            </span>
            <button
              className="stock-secondary"
              disabled={page * 20 >= rows.length}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </button>
          </div>
          <div className="import-confirm-controls">
            <label className="stock-checkbox">
              <input
                type="checkbox"
                checked={allowDuplicates}
                onChange={(e) => {
                  setAllowDuplicates(e.target.checked);
                  setAck(false);
                }}
              />
              Revisei as possíveis duplicidades e autorizo repetir as que eu
              selecionar.
            </label>
            <label className="stock-checkbox">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              Conferi os dados, as associações de produtos, os avisos e as
              linhas selecionadas.
            </label>
            <div className="stock-actions">
              <button
                className="stock-secondary"
                disabled={busy}
                onClick={() => {
                  void preview();
                }}
              >
                Atualizar prévia
              </button>
              <button
                className="button button-green"
                disabled={busy || !ack || !selected.length || dirty || !write}
                onClick={() => setConfirm(true)}
              >
                <Check size={16} />
                Importar {selected.length} registros
              </button>
              <button
                className="stock-text-button"
                disabled={busy}
                onClick={() => setCancel(true)}
              >
                Cancelar rascunho
              </button>
            </div>
          </div>
        </section>
      )}
      {batch && step === 4 && (
        <section className="stock-card import-success">
          <span>
            <CheckCheck size={34} />
          </span>
          <h2>Estoque atualizado com sua planilha.</h2>
          <p>
            {batch.result?.imported || 0} registros importados ·{" "}
            {batch.result?.ignored || 0} registros ignorados.
          </p>
          <p>
            A importação está registrada no histórico. Repetir a confirmação não
            grava os movimentos novamente.
          </p>
          <div className="stock-actions">
            <Link href="/app/estoque" className="button button-green">
              Conferir meus insumos <ArrowRight size={16} />
            </Link>
            <button className="stock-secondary" onClick={reset}>
              Trazer outra planilha
            </button>
          </div>
        </section>
      )}
      {step === 1 && batches.length > 0 && (
        <section className="stock-card">
          <div className="stock-card-heading">
            <div>
              <h2>Suas importações recentes</h2>
              <p>
                Rascunhos expiram em 24 horas. Cancelar um rascunho não altera o
                estoque.
              </p>
            </div>
          </div>
          <div
            className="stock-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Importações recentes"
          >
            <table>
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Data</th>
                  <th>Situação</th>
                  <th>Resultado</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.fileName}</strong>
                      <small>
                        {b.mode === "POSITION"
                          ? "Posição de estoque"
                          : "Histórico"}
                      </small>
                    </td>
                    <td>{new Date(b.createdAt).toLocaleDateString("pt-BR")}</td>
                    <td>
                      <span className="stock-badge">
                        {b.status === "CONFIRMED" ? "Concluída" : "Rascunho"}
                      </span>
                    </td>
                    <td>
                      {b.result
                        ? `${b.result.imported} importados`
                        : "Ainda não grava estoque"}
                    </td>
                    <td>
                      {write && (
                        <button
                          className="stock-text-button"
                          onClick={() => {
                            void resume(b.id);
                          }}
                          disabled={busy}
                        >
                          {b.status === "CONFIRMED"
                            ? "Ver resultado"
                            : "Retomar"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {editing && batch && (
        <EditImportRow
          row={editing}
          headers={batch.sheets[sheet].headers}
          property={property}
          inventory={inventory}
          locale={locale}
          close={() => setEditing(null)}
          save={async (values) => {
            const next = [
              ...edits.filter((e) => e.line !== editing.line),
              values,
            ];
            setEdits(next);
            setEditing(null);
            await preview(next);
          }}
        />
      )}
      {confirm && batch && (
        <StockDialog
          title="Confirmar importação"
          close={() => setConfirm(false)}
        >
          <div className="stock-form">
            <div className="stock-review">
              <h3>{batch.fileName}</h3>
              <p>
                Você selecionou <strong>{selected.length} registros</strong>. Os
                demais {rows.length - selected.length} serão ignorados. Os
                movimentos serão gravados em {property.name}, com sua
                identificação.
              </p>
              <p>
                {batch.mode === "POSITION"
                  ? "Esta planilha registra uma posição inicial."
                  : "Esta planilha registra movimentos históricos."}{" "}
                Confira se nenhuma abertura repete um saldo já contabilizado.
              </p>
            </div>
            <Feedback error={error} />
            <footer>
              <button
                className="stock-secondary"
                disabled={busy}
                onClick={() => setConfirm(false)}
              >
                Voltar para conferir
              </button>
              <button
                className="button button-green"
                disabled={busy}
                onClick={() => {
                  void finish();
                }}
              >
                {busy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Check size={16} />
                )}
                Confirmar importação
              </button>
            </footer>
          </div>
        </StockDialog>
      )}
      {cancel && batch && (
        <StockDialog title="Cancelar rascunho" close={() => setCancel(false)}>
          <div className="stock-form">
            <p>
              O arquivo e a prévia deste rascunho serão removidos. Nenhum saldo
              será alterado.
            </p>
            <footer>
              <button
                className="stock-secondary"
                disabled={busy}
                onClick={() => setCancel(false)}
              >
                Continuar conferindo
              </button>
              <button
                className="button button-green"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await apiRequest(`${base}/imports/${batch.id}/cancel`, {});
                    reset();
                    await load();
                  } catch (e) {
                    setCancel(false);
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Confirmar cancelamento
              </button>
            </footer>
          </div>
        </StockDialog>
      )}
    </div>
  );
}
function PackageIcon() {
  return <FileSpreadsheet size={16} />;
}
function EditImportRow({
  row,
  headers,
  inventory,
  locale,
  close,
  save,
}: {
  row: ImportRow;
  headers: string[];
  property: PropertySummary;
  inventory: InventoryView | null;
  locale: "BR" | "DOT";
  close: () => void;
  save: (value: {
    line: number;
    values: Partial<Record<ImportField, string>>;
    productId?: string | null;
  }) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<ImportField, string>>(
      () =>
        Object.fromEntries(
          fields.map((f) => [
            f,
            ["quantity", "minimum", "unitCost"].includes(f) && locale === "BR"
              ? row.values[f].replace(".", ",")
              : row.values[f],
          ]),
        ) as Record<ImportField, string>,
    ),
    [target, setTarget] = useState(row.productId || "");
  const [view, setView] = useState<"data" | "original">("data");
  return (
    <StockDialog title={`Revisar registro ${row.line}`} close={close}>
      <form
        className="stock-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save({ line: row.line, values, productId: target || null });
        }}
      >
        <div className="stock-actions">
          <button
            className="stock-secondary"
            type="button"
            aria-pressed={view === "data"}
            onClick={() => setView("data")}
          >
            Dados interpretados
          </button>
          <button
            className="stock-secondary"
            type="button"
            aria-pressed={view === "original"}
            onClick={() => setView("original")}
          >
            Valores originais
          </button>
        </div>
        {view === "original" ? (
          <dl className="import-original">
            {headers.map((h, i) => (
              <div key={i}>
                <dt>{h}</dt>
                <dd>{row.original[i] || "(vazio)"}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <>
            <label>
              Associar a um produto
              <Select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Criar / conferir pelo nome informado</option>
                {inventory?.products
                  .filter((p) => !p.archived)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.unit})
                    </option>
                  ))}
              </Select>
            </label>
            <div className="stock-form-grid">
              {fields.map((f) => (
                <label key={f}>
                  {importFields[f]}
                  {f === "category" ? <Select value={values[f]} onChange={e=>setValues({...values,category:e.target.value})}><option value="">Selecione uma categoria ativa</option>{values[f] && !inventory?.categories?.some(c=>!c.archived&&c.name===values[f]) && <option value={values[f]} disabled>{values[f]} (associação pendente)</option>}{inventory?.categories?.filter(c=>!c.archived).map(c=><option key={c.id} value={c.name}>{c.name}</option>)}</Select> : <input
                    maxLength={500}
                    value={values[f]}
                    onChange={(e) =>
                      setValues({ ...values, [f]: e.target.value })
                    }
                  />}
                </label>
              ))}
            </div>
            <p className="stock-help">
              Tipo: abertura, entrada, consumo ou descarte. Data: DD/MM/AAAA ou
              AAAA-MM-DD. Validade: data completa, N/A ou vazio. Conversões de
              unidade devem ser feitas explicitamente.
            </p>
          </>
        )}
        <footer>
          <button type="button" className="stock-secondary" onClick={close}>
            Voltar
          </button>
          <button className="button button-green">
            Aplicar correção e validar
          </button>
        </footer>
      </form>
    </StockDialog>
  );
}

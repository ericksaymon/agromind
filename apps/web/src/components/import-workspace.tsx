"use client";
import { useCallback, useEffect, useState } from "react";
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
const fields = Object.keys(importFields) as ImportField[];
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
    [aiNote, setAiNote] = useState("");
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
  async function upload(e: React.FormEvent) {
    e.preventDefault();
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
        mode,
      });
      setBatch(draft);
      setMapping(draft.mapping);
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
        {["Enviar planilha", "Associar colunas", "Conferir e confirmar"].map(
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
                <h2>Escolha o ponto de partida</h2>
                <p>
                  Produtos e movimentações ficam vinculados a {property.name}.
                </p>
              </div>
            </div>
            <form className="stock-form" onSubmit={upload}>
              <fieldset className="import-mode-options">
                <legend>O que a planilha representa?</legend>
                <label>
                  <input
                    type="radio"
                    name="import-mode"
                    checked={mode === "POSITION"}
                    onChange={() => setMode("POSITION")}
                  />
                  <span>
                    <strong>Posição de estoque</strong>
                    <small>
                      Quantidades disponíveis em uma data. Gera abertura; não
                      cria consumo passado.
                    </small>
                  </span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="import-mode"
                    checked={mode === "HISTORY"}
                    onChange={() => setMode("HISTORY")}
                  />
                  <span>
                    <strong>Histórico de movimentações</strong>
                    <small>
                      Aberturas, entradas, consumo e descarte, com data e tipo
                      em cada registro.
                    </small>
                  </span>
                </label>
              </fieldset>
              <label className="import-file-input">
                <Upload size={27} />
                <strong>Selecione sua planilha</strong>
                <span>
                  CSV UTF-8 ou XLSX · até 1 MB, 1.000 registros e 32 colunas
                </span>
                <input
                  aria-label="Arquivo da planilha"
                  type="file"
                  accept=".csv,.xlsx"
                  required
                  disabled={!write}
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </label>
              <p className="stock-help">
                Use cabeçalhos na primeira linha. Fórmulas devem ser
                substituídas por valores. Nenhum dado de estoque é gravado ao
                enviar o arquivo.
              </p>
              <footer>
                <button
                  className="button button-green"
                  disabled={busy || !write || !file}
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
            <h2>O que você pode trazer</h2>
            <p>
              Produto, categoria, quantidade, unidade, estoque mínimo e custo
              por unidade.
            </p>
            <p>
              Também aceitamos lote, validade, fornecedor, data, tipo de
              movimento, destino, observações e identificador de origem.
            </p>
            <div className="import-guide-note">
              Sem custo ou validade? Esses campos ficam como não informados.
              Nenhum valor será inventado.
            </div>
            <a className="stock-secondary" href="/modelo-estoque.csv" download>
              Baixar modelo de estoque <ArrowRight size={15} />
            </a>
            <a
              className="stock-secondary"
              href="/modelo-movimentacoes.csv"
              download
            >
              Baixar modelo de histórico <ArrowRight size={15} />
            </a>
          </aside>
        </div>
      )}
      {batch && step === 2 && (
        <section className="stock-card">
          <div className="stock-card-heading">
            <div>
              <h2>Associe as colunas da planilha</h2>
              <p>
                {batch.fileName} ·{" "}
                {batch.mode === "POSITION"
                  ? "Posição de estoque"
                  : "Histórico de movimentações"}
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
            <div className="stock-form-grid">
              <label>
                Aba da planilha
                <select
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
                </select>
              </label>
              <label>
                Formato dos números
                <select
                  value={locale}
                  onChange={(e) => {
                    setLocale(e.target.value as typeof locale);
                    setEdits([]);
                    setDirty(true);
                  }}
                >
                  <option value="BR">Brasileiro: 1.250,50</option>
                  <option value="DOT">Ponto decimal: 1250.50</option>
                </select>
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
                <h3>Ajuda para entender as colunas</h3>
                <p>
                  {batch.aiAvailable
                    ? "A IA recebe somente os cabeçalhos, sugere associações e você confere. As linhas e quantidades não são enviadas."
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
                Enviar cabeçalhos à IA
              </button>
            </div>
            <div className="import-mapping">
              {fields.map((field) => (
                <label key={field}>
                  <span>
                    {importFields[field]}
                    {[
                      "product",
                      "quantity",
                      "unit",
                      ...(batch.mode === "HISTORY" ? ["kind", "date"] : []),
                    ].includes(field) && <small> obrigatório</small>}
                  </span>
                  <select
                    value={mapping[field] ?? ""}
                    onChange={(e) => {
                      setMapping({
                        ...mapping,
                        [field]:
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value),
                      });
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
                  </select>
                  <small>
                    {mapping[field] !== undefined
                      ? `Ex.: ${batch.sheets[sheet]?.rows[0]?.[mapping[field]!] || "(vazio)"}`
                      : "Você poderá corrigir os dados por registro na prévia."}
                  </small>
                </label>
              ))}
            </div>
            <p className="stock-help">
              Na posição de estoque, cada registro gera uma abertura de lote.
              Produtos que já têm histórico exigem movimentos ou ajuste
              conciliado. No histórico, tipo e data são obrigatórios. Custos
              sempre em reais por unidade; converta outras moedas antes de
              enviar.
            </p>
            <footer>
              <button
                type="button"
                className="button button-green"
                disabled={busy || !write}
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
              <h2>Confira o que será importado</h2>
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
                          {row.duplicate ? "Possível duplicidade" : "Conferir"}
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
              <select
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
              </select>
            </label>
            <div className="stock-form-grid">
              {fields.map((f) => (
                <label key={f}>
                  {importFields[f]}
                  <input
                    maxLength={500}
                    value={values[f]}
                    onChange={(e) =>
                      setValues({ ...values, [f]: e.target.value })
                    }
                  />
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

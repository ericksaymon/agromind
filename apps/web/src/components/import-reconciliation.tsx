"use client";
import { useMemo, useState } from "react";
import type {
  ImportView,
  InventoryView,
} from "../../../../packages/contracts/src/index";
import { reconcileImport } from "../../../../packages/contracts/src/reconciliation";
import { number } from "./stock-workspace";

export function ImportReconciliation({
  batch,
  inventory,
  selected,
}: {
  batch: ImportView;
  inventory: InventoryView;
  selected: number[];
}) {
  const rows = useMemo(
    () => reconcileImport(batch.rows, selected, inventory),
    [batch.rows, selected, inventory],
  );
  const [references, setReferences] = useState<Record<string, string>>({});
  const current = batch.revision === inventory.revision;
  return (
    <section
      className="refinement-panel"
      aria-labelledby="reconciliation-title"
    >
      <h3 id="reconciliation-title">Conciliação dos saldos selecionados</h3>
      <p>
        {batch.mode === "POSITION"
          ? "Estratégia: posição inicial. A quantidade informada vira abertura; produtos com histórico existente são bloqueados."
          : "Estratégia: histórico. Entradas e retiradas selecionadas são aplicadas ao saldo existente. Não importe uma posição final como outra entrada."}
      </p>
      {!current ? (
        <p role="status" className="stock-warning">
          A referência de estoque mudou. Volte às colunas e gere uma nova prévia
          antes de confirmar.
        </p>
      ) : (
        <>
          <div
            className="stock-table-scroll"
            role="region"
            aria-label="Conciliação dos saldos"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Saldo atual</th>
                  <th>Entradas</th>
                  <th>Retiradas</th>
                  <th>Saldo após importar</th>
                  <th>Saldo conferido na fonte (opcional)</th>
                  <th>Conferência</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const raw = references[p.id] || "",
                    parsed = raw.trim().replace(",", ".");
                  const valid =
                    /^\d+(\.\d{1,3})?$/.test(parsed) &&
                    Number.isFinite(Number(parsed));
                  const difference = valid
                    ? Number(parsed) - Number(p.after)
                    : null;
                  return (
                    <tr key={p.id}>
                      <th scope="row">
                        {p.name}
                        <small>
                          {p.unit} · linhas {p.lines.join(", ")}
                        </small>
                      </th>
                      <td>{number(p.before)}</td>
                      <td>{number(p.incoming)}</td>
                      <td>{number(p.outgoing)}</td>
                      <td>{number(p.after)}</td>
                      <td>
                        <input
                          aria-label={`Saldo conferido de ${p.name}`}
                          inputMode="decimal"
                          value={raw}
                          onChange={(e) =>
                            setReferences({
                              ...references,
                              [p.id]: e.target.value,
                            })
                          }
                          placeholder="Não informado"
                        />
                      </td>
                      <td>
                        {!raw.trim()
                          ? "Sem referência externa"
                          : !valid
                            ? "Informe um saldo válido"
                            : Math.abs(difference!) < 0.0005
                              ? "Saldos conferem"
                              : `Divergência: ${number(difference!)} ${p.unit}. Revise ou desmarque as linhas.`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!rows.length && (
            <p>Selecione registros válidos para conferir o resultado.</p>
          )}
          <p className="stock-help">
            A referência opcional serve somente à conferência desta tela e não
            ajusta o estoque. Para resolver divergências, corrija ou desmarque
            registros; se precisar, cancele e escolha o outro tipo de
            importação. A confirmação final revalida saldo, lotes e datas no
            servidor.
          </p>
        </>
      )}
    </section>
  );
}

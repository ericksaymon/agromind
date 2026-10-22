"use client";
import type {
  ProductAnalysis,
  ProductView,
} from "../../../../packages/contracts/src/index";
export function ProductDataQuality({
  product,
  analysis,
  canWrite,
  edit,
  coverage,
}: {
  product: ProductView;
  analysis: ProductAnalysis;
  canWrite: boolean;
  edit: () => void;
  coverage: () => void;
}) {
  const priced = !product.lots.some(
    (l) => Number(l.balance) > 0 && l.unitCost === null,
  );
  const expiry = !product.lots.some(
    (l) => Number(l.balance) > 0 && l.expiryStatus === "UNKNOWN",
  );
  const history = analysis.dailyAverage !== null;
  const items = [
    {
      label: "Estoque mínimo",
      complete: product.minimumKnown,
      detail: product.minimumKnown
        ? "Referência confirmada no cadastro."
        : "Confirme o mínimo fornecido para este produto.",
      action: "Revisar mínimo",
      run: edit,
    },
    {
      label: "Preço dos lotes",
      complete: priced,
      detail: priced
        ? "Sem saldo com custo ausente."
        : "Há saldo sem preço; os valores financeiros ficam parciais.",
      action: "Conferir lotes",
      href: "#lotes",
    },
    {
      label: "Validade dos lotes",
      complete: expiry,
      detail: expiry
        ? "Sem saldo com validade desconhecida."
        : "Validade desconhecida fica fora do saldo elegível.",
      action: "Conferir validades",
      href: "#lotes",
    },
    {
      label: "Histórico de consumo",
      complete: history,
      detail: history
        ? "Existe cobertura suficiente para a média atual."
        : "Confira a cobertura, os dias disponíveis e a classificação das retiradas.",
      action: "Revisar histórico",
      run: coverage,
    },
  ];
  return (
    <section
      className="refinement-panel"
      aria-label="Qualidade dos dados do produto"
    >
      <h3>Qualidade dos dados</h3>
      <p>
        {items.filter((i) => i.complete).length} de 4 verificações atendidas.
        Isto indica preenchimento e condições de cálculo; não comprova a
        exatidão dos registros.
      </p>
      <ul className="quality-list">
        {items.map((i) => (
          <li key={i.label}>
            <div>
              <strong>
                {i.label}: {i.complete ? "atendido" : "conferir"}
              </strong>
              <p>{i.detail}</p>
            </div>
            {!i.complete &&
              (i.href ? (
                <a className="stock-text-button" href={i.href}>
                  {i.action}
                </a>
              ) : canWrite ? (
                <button className="stock-text-button" onClick={i.run}>
                  {i.action}
                </button>
              ) : (
                <span className="stock-help">
                  Solicite a revisão ao responsável.
                </span>
              ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

import { Prisma } from "./generated/prisma/client";
import type { Product, StockLot, StockMovement } from "./generated/prisma/client";
import type { AnalysisAlert, AnalysisPolicy, AnalysisResult, ProductAnalysis } from "../../../packages/contracts/src/index";

import { dateKey, shiftDay, dayStamp as stamp, RULE_VERSION } from "./analysis-common";
import { buildIntelligence, type IntelligenceOptions } from "./intelligence-engine";
export { dateKey, shiftDay, RULE_VERSION } from "./analysis-common";
const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const sum = (values: Prisma.Decimal[]) => values.reduce((a, b) => a.plus(b), D(0));
const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
export type AnalysisInput = Product & { lots: StockLot[]; movements: StockMovement[] };
export function calculateAnalysis(products: AnalysisInput[], referenceDay: string, timezone: string, revision: number, policy: AnalysisPolicy, options: IntelligenceOptions = {}): AnalysisResult {
  const alerts: AnalysisAlert[] = [];
  const metrics: ProductAnalysis[] = [];
  let riskValue = D(0), value = D(0), unpricedLots = 0, expiringLots = 0;
  for (const p of products.filter(p => !p.archived)) {
    const lots = p.lots.filter(l => l.balance.gt(0));
    const physical = sum(lots.map(l => l.balance));
    const expiredLots = lots.filter(l => l.expiryStatus === "DATED" && day(l.expiresOn)! < referenceDay);
    const eligibleLots = lots.filter(l => l.expiryStatus === "NA" || (l.expiryStatus === "DATED" && day(l.expiresOn)! >= referenceDay));
    const unknown = sum(lots.filter(l => l.expiryStatus === "UNKNOWN").map(l => l.balance));
    const eligible = sum(eligibleLots.map(l => l.balance));
    const known = sum(lots.filter(l => l.unitCost !== null).map(l => l.balance.mul(l.unitCost!)));
    const unpriced = lots.filter(l => l.unitCost === null).length;
    value = value.plus(known); unpricedLots += unpriced;
    const end = shiftDay(referenceDay, -1);
    const coverageStart = day(p.coverageStart), coverageEnd = p.coverageOngoing ? end : day(p.coverageEnd);
    // Uma lacuna após o intervalo confirmado impede estimar o ritmo atual.
    const covered = !!coverageStart && !!coverageEnd && coverageEnd >= end && coverageStart <= end;
    const from = covered ? [coverageStart!, shiftDay(referenceDay, -30)].sort().at(-1)! : null;
    const observedDays = from ? stamp(end) - stamp(from) + 1 : 0;
    const reversed = new Set(p.movements.filter(m => m.reversalOf).map(m => m.reversalOf));
    const valid = p.movements.filter(m => !m.reversalOf && !reversed.has(m.id));
    const movementDays = new Map(valid.map(m => [m.id, dateKey(m.occurredAt, timezone)]));
    const included = valid.filter(m => m.kind === "CONSUMPTION" && m.consumptionConfirmed && from && movementDays.get(m.id)! >= from && movementDays.get(m.id)! <= end);
    const dailyTotals = new Map<string, Prisma.Decimal>();
    for (const m of included) { const d = movementDays.get(m.id)!; dailyTotals.set(d, (dailyTotals.get(d) ?? D(0)).plus(m.delta.abs())); }
    const daily = Array.from({ length: observedDays }, (_, i) => {
      const d = shiftDay(from!, i);
      return { day: d, quantity: (dailyTotals.get(d) ?? D(0)).toString() };
    });
    const consumption = sum(included.map(m => m.delta.abs()));
    const average = observedDays >= 7 && consumption.gt(0) ? consumption.div(observedDays) : null;
    const autonomy = average ? eligible.div(average) : null;
    const mean = average?.toNumber() ?? 0;
    const unstable = mean > 0 && Math.sqrt(daily.reduce((s, d) => s + (Number(d.quantity) - mean) ** 2, 0) / observedDays) > mean;
    const limitations: string[] = [];
    if (!covered) limitations.push("Cobertura do histórico não confirmada até ontem. Ainda não há histórico suficiente para estimar o ritmo atual.");
    else if (observedDays < 7) limitations.push("Menos de 7 dias completos confirmados. Ainda não há histórico suficiente.");
    else if (!average) limitations.push("Sem consumo registrado no período; autonomia não calculável.");
    if (observedDays >= 7 && observedDays < 30) limitations.push("Estimativa preliminar: janela inferior a 30 dias.");
    if (unstable) limitations.push("Consumo irregular: o desvio diário supera a média. A projeção pode variar bastante.");
    if (unknown.gt(0)) limitations.push("Validade desconhecida: saldo separado e excluído da autonomia conservadora; verificar antes do uso.");
    if (!p.minimumKnown) limitations.push("Estoque mínimo não confirmado.");
    if (p.minimumKnown && p.minimum.eq(0)) limitations.push("Limite mínimo desativado (zero informado).");
    if (unpriced) limitations.push("Valor financeiro parcial: há lotes sem custo informado.");
    if (valid.some(m => m.kind === "CONSUMPTION" && !m.consumptionConfirmed)) limitations.push("Há saídas genéricas não classificadas como uso; excluídas do consumo médio.");
    const metric: ProductAnalysis = {
      id: p.id, name: p.name, category: p.category, unit: p.unit, physical: physical.toString(), eligible: eligible.toString(),
      expired: sum(expiredLots.map(l => l.balance)).toString(), unknownExpiry: unknown.toString(), minimum: p.minimum.toString(), minimumKnown: p.minimumKnown,
      knownValue: known.toFixed(2), unpricedLots: unpriced, consumption: consumption.toString(), observedDays, from, to: end,
      dailyAverage: average?.toString() ?? null, autonomyDays: autonomy?.toString() ?? null, unstable, preliminary: observedDays < 30,
      limitations, daily, coverageStart, coverageEnd: day(p.coverageEnd), coverageOngoing: p.coverageOngoing,
      leadTimeDays: p.leadTimeDays, safetyDays: p.safetyDays, movementIds: included.map(m => m.id),
    };
    metrics.push(metric);
    const add = (rule: string, priority: AnalysisAlert["priority"], title: string, explanation: string, suggestion: string, deadlineDays: number | null = null, lot: StockLot | null = null, exposed = D(0)) => {
      alerts.push({ identity: `${rule}:${p.id}:${lot?.id ?? "product"}`, productId: p.id, productName: p.name, category: p.category, unit: p.unit,
        lotId: lot?.id ?? null, lotCode: lot?.code ?? null, rule, priority, title, explanation, suggestion, deadlineDays,
        exposedQuantity: exposed.toString(), knownValue: lot?.unitCost ? exposed.mul(lot.unitCost).toFixed(2) : "0.00", partialCost: !!lot && lot.unitCost === null,
        limitations: [...limitations], referenceDay, revision, ruleVersion: RULE_VERSION, policyVersion: policy.policyVersion });
    };
    if (p.minimumKnown && p.minimum.gt(0) && eligible.lt(p.minimum)) add("MINIMUM", "HIGH", "Estoque abaixo do mínimo", `${eligible} ${p.unit} elegíveis para um mínimo informado de ${p.minimum} ${p.unit}. Saldo físico: ${physical} ${p.unit}.`, "Confira a disponibilidade e planeje a reposição. Validade desconhecida requer verificação.");
    const horizon = p.leadTimeDays === null ? policy.reorderDays : p.leadTimeDays + p.safetyDays;
    if (autonomy && autonomy.lte(horizon)) add("SHORTAGE", eligible.eq(0) ? "CRITICAL" : "HIGH", eligible.eq(0) ? "Sem saldo elegível conhecido" : "Planeje a reposição", `${eligible} ${p.unit} / ${average!.toDecimalPlaces(4)} ${p.unit}/dia = ${autonomy.toDecimalPlaces(2)} dias. Janela ${from} a ${end}, ${observedDays} dias completos. Horizonte: ${horizon} dias (${p.leadTimeDays === null ? "política provisória da propriedade" : "prazo de reposição + margem"}).`, "Confirme as condições dos lotes e o prazo de compra; a estimativa não garante entrega ou demanda futura.", autonomy.toNumber());
    let allocated = D(0);
    const riskByLot = new Map<string, Prisma.Decimal>();
    for (const lot of expiredLots) {
      add("EXPIRED", "CRITICAL", "Lote vencido com saldo", `Lote ${lot.code}: validade ${day(lot.expiresOn)}, saldo ${lot.balance} ${p.unit}. Excluído da autonomia.`, "Separe o lote e confira a destinação adequada; registrar descarte exige confirmação.", stamp(day(lot.expiresOn)!) - stamp(referenceDay), lot, lot.balance);
      riskByLot.set(lot.id, lot.balance);
    }
    for (const lot of eligibleLots.filter(l => l.expiryStatus === "DATED").sort((a, b) => a.expiresOn!.getTime() - b.expiresOn!.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))) {
      const days = stamp(day(lot.expiresOn)!) - stamp(referenceDay);
      const capacity = average ? Prisma.Decimal.max(0, average.mul(days + 1).minus(allocated)) : D(0);
      const used = average ? Prisma.Decimal.min(lot.balance, capacity) : D(0);
      allocated = allocated.plus(used);
      const loss = average ? lot.balance.minus(used) : null;
      if (days <= policy.expiryWarningDays) {
        expiringLots++;
        add("EXPIRY", days === 0 ? "CRITICAL" : "MODERATE", days === 0 ? "Lote vence hoje" : "Lote próximo do vencimento", `Lote ${lot.code}: ${lot.balance} ${p.unit}, validade ${day(lot.expiresOn)} (${days} dias).`, "Confira a programação de uso e priorize lotes elegíveis por validade; não utilize produto vencido.", days, lot, lot.balance);
        riskByLot.set(lot.id, lot.balance);
      }
      if (loss?.gt(0)) {
        add("EXPIRY_LOSS", days === 0 ? "CRITICAL" : "HIGH", "Pode sobrar produto na validade", `FEFO: até ${day(lot.expiresOn)}, capacidade projetada restante de ${capacity.toDecimalPlaces(3)} ${p.unit}; lote com ${lot.balance} ${p.unit}; sobra estimada ${loss.toDecimalPlaces(3)} ${p.unit}. Demanda distribuída uma única vez entre lotes. Base: ${from} a ${end}, média ${average!.toDecimalPlaces(4)} ${p.unit}/dia.`, "Revise o planejamento de uso e compras; esta projeção de ritmo constante não é garantia de perda.", days, lot, loss);
        riskByLot.set(lot.id, Prisma.Decimal.max(riskByLot.get(lot.id) ?? 0, loss));
      }
    }
    const inactiveStart = shiftDay(referenceDay, -policy.inactivityDays);
    if (covered && coverageStart! <= inactiveStart && physical.gt(0)) {
      const recent = valid.filter(m => movementDays.get(m.id)! >= inactiveStart && movementDays.get(m.id)! < referenceDay);
      if (!recent.some(m => m.kind === "CONSUMPTION" && m.consumptionConfirmed)) add("NO_CONSUMPTION", "MODERATE", "Sem consumo no período observado", `${policy.inactivityDays} dias completos sem consumo confirmado. ${recent.length ? "Há outros movimentos registrados." : "Nenhuma movimentação no período."} Histórico declarado completo.`, "Confira se há uso sazonal, registros pendentes ou necessidade de rever compras.");
    }
    for (const [id, qty] of riskByLot) { const l = lots.find(l => l.id === id)!; if (l.unitCost !== null) riskValue = riskValue.plus(Prisma.Decimal.min(qty, l.balance).mul(l.unitCost)); }
  }
  const intelligence = buildIntelligence(products, metrics, referenceDay, timezone, revision, policy, { ...options, propertyKnownValue: value.toString() });
  alerts.push(...intelligence.signals);
  const rank = { CRITICAL: 0, HIGH: 1, MODERATE: 2 };
  alerts.sort((a, b) => rank[a.priority] - rank[b.priority] || (a.deadlineDays ?? Infinity) - (b.deadlineDays ?? Infinity) || D(b.knownValue).cmp(a.knownValue) || a.identity.localeCompare(b.identity));
  return { referenceDay, timezone, ruleVersion: RULE_VERSION, revision, policy, products: metrics, alerts, intelligence,
    summary: { products: metrics.length, knownValue: value.toFixed(2), unpricedLots, criticalProducts: new Set(alerts.filter(a => a.priority === "CRITICAL").map(a => a.productId)).size,
      expiringLots, knownRiskValue: riskValue.toFixed(2), incompleteProducts: metrics.filter(p => p.limitations.length > 0).length } };
}

import { Prisma } from "./generated/prisma/client";
import type { StockMovement } from "./generated/prisma/client";
import type { AnalysisInput } from "./analysis-engine";
import { dateKey, dayStamp, shiftDay, RULE_VERSION } from "./analysis-common";
import { projectInventory } from "./intelligence-projection";
import {
  defaultIntelligencePolicy,
  type AnalysisAlert,
  type AnalysisPolicy,
  type IntelligenceProduct,
  type IntelligenceResult,
  type IntelligenceSeriesPoint,
  type ProductAnalysis,
} from "../../../packages/contracts/src/index";
const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const sum = (v: Prisma.Decimal[]) => v.reduce((a, b) => a.plus(b), D(0));
const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
const median = (values: Prisma.Decimal[]) => {
  const sorted = values.slice().sort((a, b) => a.cmp(b)),
    n = sorted.length;
  return n % 2
    ? sorted[Math.floor(n / 2)]
    : sorted[n / 2 - 1].plus(sorted[n / 2]).div(2);
};
export interface IntelligenceOptions {
  from?: string;
  to?: string;
  grouping?: "DAY" | "WEEK" | "MONTH";
  horizonDays?: number;
  propertyKnownValue?: string;
}
export function buildIntelligence(
  products: AnalysisInput[],
  metrics: ProductAnalysis[],
  referenceDay: string,
  timezone: string,
  revision: number,
  policy: AnalysisPolicy,
  options: IntelligenceOptions = {},
): IntelligenceResult {
  const config = { ...defaultIntelligencePolicy, ...policy.intelligence };
  const to = options.to ?? shiftDay(referenceDay, -1),
    from = options.from ?? shiftDay(to, 1 - config.comparisonDays);
  const days = dayStamp(to) - dayStamp(from) + 1,
    previousTo = shiftDay(from, -1),
    previousFrom = shiftDay(from, -days);
  const detectorTo = shiftDay(referenceDay, -1),
    detectorFrom = shiftDay(referenceDay, -config.comparisonDays),
    detectorPrevious = shiftDay(detectorFrom, -config.comparisonDays);
  const signals: AnalysisAlert[] = [],
    results: IntelligenceProduct[] = [],
    anomalies: IntelligenceResult["anomalies"] = [];
  const totalCurrent =
    options.propertyKnownValue !== undefined
      ? D(options.propertyKnownValue)
      : sum(
          products
            .filter((p) => !p.archived)
            .flatMap((p) =>
              p.lots
                .filter((l) => l.unitCost !== null)
                .map((l) => l.balance.mul(l.unitCost!)),
            ),
        );
  const precise = new Map<
    string,
    {
      currentValue: Prisma.Decimal;
      purchaseValue: Prisma.Decimal;
      consumptionValue: Prisma.Decimal;
      idle: Prisma.Decimal;
      excess: Prisma.Decimal;
      exposure: Prisma.Decimal;
      budget: Prisma.Decimal;
    }
  >();
  for (const p of products) {
    const m = metrics.find((m) => m.id === p.id);
    const reversed = new Set(
      p.movements.filter((x) => x.reversalOf).map((x) => x.reversalOf),
    );
    const movements = p.movements
      .filter((x) => !x.reversalOf && !reversed.has(x.id))
      .slice()
      .sort(
        (a, b) =>
          a.occurredAt.getTime() - b.occurredAt.getTime() ||
          (a.sequence < b.sequence
            ? -1
            : a.sequence > b.sequence
              ? 1
              : a.id.localeCompare(b.id)),
      );
    const dates = new Map(
      movements.map((x) => [x.id, dateKey(x.occurredAt, timezone)]),
    );
    const usage = movements.filter(
      (x) => x.kind === "CONSUMPTION" && x.consumptionConfirmed,
    );
    const coverStart = iso(p.coverageStart),
      coverEnd = p.coverageOngoing ? detectorTo : iso(p.coverageEnd);
    const covered = (a: string, b: string) =>
      !!coverStart && !!coverEnd && coverStart <= a && coverEnd >= b;
    const between = (xs: StockMovement[], a: string, b: string) =>
      xs.filter((x) => dates.get(x.id)! >= a && dates.get(x.id)! <= b);
    const quantity = (xs: StockMovement[]) => sum(xs.map((x) => x.delta.abs()));
    const current = between(usage, from, to),
      previous = between(usage, previousFrom, previousTo);
    const currentQty = quantity(current),
      previousQty = quantity(previous),
      currentCovered = covered(from, to),
      previousCovered = covered(previousFrom, previousTo);
    const comparisonStatus =
      !currentCovered || !previousCovered
        ? "INSUFFICIENT"
        : previousQty.eq(0)
          ? currentQty.gt(0)
            ? "STARTED"
            : "NO_CONSUMPTION"
          : "COMPARABLE";
    const percent =
      comparisonStatus === "COMPARABLE"
        ? currentQty.minus(previousQty).div(previousQty).mul(100)
        : null;
    const limitations = [...(m?.limitations ?? [])];
    if (!currentCovered || !previousCovered)
      limitations.push(
        "Comparação sem cobertura completa nos dois períodos; registros ausentes não foram preenchidos com zero.",
      );
    if (comparisonStatus === "STARTED")
      limitations.push(
        "Consumo anterior zero: início de consumo, sem variação percentual calculável.",
      );
    if (p.archived)
      limitations.push(
        "Produto arquivado: movimentos preservados no histórico, excluído dos valores atuais e novas recomendações.",
      );
    const series: IntelligenceSeriesPoint[] = [];
    for (let start = from; start <= to; ) {
      let end = start;
      if (options.grouping === "WEEK") end = shiftDay(start, 6);
      if (options.grouping === "MONTH")
        end = new Date(
          Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0),
        )
          .toISOString()
          .slice(0, 10);
      if (end > to) end = to;
      const isCovered = covered(start, end),
        totalDays = dayStamp(end) - dayStamp(start) + 1;
      series.push({
        from: start,
        to: end,
        quantity: isCovered
          ? quantity(between(usage, start, end)).toString()
          : null,
        coveredDays:
          coverStart && coverEnd
            ? Math.max(
                0,
                Math.min(dayStamp(end), dayStamp(coverEnd)) -
                  Math.max(dayStamp(start), dayStamp(coverStart)) +
                  1,
              )
            : 0,
        totalDays,
      });
      start = shiftDay(end, 1);
    }
    const moneySum = (xs: StockMovement[]) =>
      sum(
        xs
          .filter((x) => x.unitCost !== null)
          .map((x) => x.delta.abs().mul(x.unitCost!)),
      );
    const moneyValue = (xs: StockMovement[]) => moneySum(xs).toFixed(2);
    const purchases = movements.filter((x) => x.kind === "IN"),
      selectedPurchases = between(purchases, from, to);
    const priced = purchases.filter((x) => x.unitCost !== null);
    const last = priced.at(-1),
      prior = priced.at(-2);
    const pricePercent =
      last && prior && prior.unitCost!.gt(0)
        ? last.unitCost!.minus(prior.unitCost!).div(prior.unitCost!).mul(100)
        : null;
    const reportPriced = priced.filter((x) => dates.get(x.id)! <= to),
      reportLast = reportPriced.at(-1),
      reportPrior = reportPriced.at(-2);
    const reportPricePercent =
      reportLast && reportPrior && reportPrior.unitCost!.gt(0)
        ? reportLast
            .unitCost!.minus(reportPrior.unitCost!)
            .div(reportPrior.unitCost!)
            .mul(100)
        : null;
    const pricePoint = (x: StockMovement) => ({
      id: x.id,
      day: dates.get(x.id)!,
      quantity: x.delta.toString(),
      unitCost: x.unitCost?.toString() ?? null,
      supplier: p.lots.find((l) => l.id === x.lotId)?.supplier ?? null,
      lotCode: p.lots.find((l) => l.id === x.lotId)?.code ?? "—",
    });
    const positiveLots = p.lots.filter((l) => l.balance.gt(0));
    const knownQty = sum(
      positiveLots.filter((l) => l.unitCost !== null).map((l) => l.balance),
    );
    const knownStockValue = sum(
      positiveLots
        .filter((l) => l.unitCost !== null)
        .map((l) => l.balance.mul(l.unitCost!)),
    );
    const weighted = knownQty.gt(0) ? knownStockValue.div(knownQty) : null;
    const cost = last?.unitCost ?? weighted;
    const priceReference = last
      ? `Última aquisição conhecida: ${dates.get(last.id)}; não é cotação futura.`
      : weighted
        ? "Custo médio dos saldos com preço conhecido; não é cotação futura."
        : null;
    const horizonDays = Math.max(
      options.horizonDays ?? 30,
      p.leadTimeDays === null
        ? policy.reorderDays
        : p.leadTimeDays + p.safetyDays,
    );
    const rate = m?.dailyAverage ? D(m.dailyAverage) : null;
    const projection =
      m && rate
        ? projectInventory(p.lots, rate, referenceDay, horizonDays)
        : null;
    const eligible = D(m?.eligible ?? 0),
      usable = projection
        ? Prisma.Decimal.max(0, eligible.minus(projection.expiredQuantity))
        : eligible;
    const target =
      !p.archived && (rate || (p.minimumKnown && p.minimum.gt(0)))
        ? Prisma.Decimal.max(
            p.minimumKnown ? p.minimum : 0,
            rate ? rate.mul(horizonDays) : 0,
          )
        : null;
    const suggestion = target
      ? Prisma.Decimal.max(0, target.minus(usable)).toDecimalPlaces(
          p.unit === "un" ? 0 : 3,
          Prisma.Decimal.ROUND_CEIL,
        )
      : null;
    const share =
      m && totalCurrent.gt(0)
        ? knownStockValue.div(totalCurrent).mul(100)
        : null;
    const idleCovered = covered(
      shiftDay(referenceDay, -policy.inactivityDays),
      detectorTo,
    );
    const idle =
      !!m &&
      D(m.physical).gt(0) &&
      idleCovered &&
      !between(
        usage,
        shiftDay(referenceDay, -policy.inactivityDays),
        detectorTo,
      ).length;
    const excessTarget =
      rate && m && !m.unstable
        ? Prisma.Decimal.max(
            p.minimumKnown ? p.minimum : 0,
            rate.mul(config.excessDays),
          )
        : null;
    const excess = excessTarget
      ? Prisma.Decimal.max(0, eligible.minus(excessTarget))
      : null;
    // Atribui o excedente aos lotes posteriores da ordem FEFO. Parado e excesso usam união por lote.
    let remainingExcess = excess ?? D(0),
      excessValue = D(0),
      idleValue = D(0),
      exposure = D(0);
    const lotOrder = positiveLots
      .slice()
      .sort(
        (a, b) =>
          (iso(a.expiresOn) ?? "9999").localeCompare(
            iso(b.expiresOn) ?? "9999",
          ) ||
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      )
      .reverse();
    for (const l of lotOrder) {
      const lotEligible =
        l.expiryStatus === "NA" ||
        (l.expiryStatus === "DATED" && iso(l.expiresOn)! >= referenceDay);
      const extra = lotEligible
        ? Prisma.Decimal.min(l.balance, remainingExcess)
        : D(0);
      remainingExcess = remainingExcess.minus(extra);
      const idleQty = idle ? l.balance : D(0);
      if (l.unitCost !== null) {
        excessValue = excessValue.plus(extra.mul(l.unitCost));
        idleValue = idleValue.plus(idleQty.mul(l.unitCost));
        exposure = exposure.plus(
          Prisma.Decimal.max(extra, idleQty).mul(l.unitCost),
        );
      }
    }
    const blocks = [3, 2, 1].map((i) =>
      quantity(
        between(
          usage,
          shiftDay(referenceDay, -i * 7),
          shiftDay(referenceDay, -(i - 1) * 7 - 1),
        ),
      ),
    );
    const trendCovered = covered(shiftDay(referenceDay, -21), detectorTo);
    const trend =
      trendCovered &&
      blocks[0].gt(0) &&
      blocks[1].gte(
        blocks[0].mul(D(1).plus(D(config.trendPercent).div(100))),
      ) &&
      blocks[2].gte(
        blocks[1].mul(D(1).plus(D(config.trendPercent).div(100))),
      ) &&
      blocks[2].minus(blocks[0]).gte(config.minimumChangeQuantity);
    const r: IntelligenceProduct = {
      id: p.id,
      name: p.name,
      category: p.category,
      unit: p.unit,
      archived: p.archived,
      currentConsumption: currentQty.toString(),
      previousConsumption: previousQty.toString(),
      currentCovered,
      previousCovered,
      comparisonStatus,
      changePercent: percent?.toString() ?? null,
      difference: currentQty.minus(previousQty).toString(),
      currentRecords: current.length,
      previousRecords: previous.length,
      series,
      trend: {
        blocks: blocks.map((b) => b.toString()),
        detected: trend,
        covered: trendCovered,
      },
      currentValue: m?.knownValue ?? "0.00",
      eligible: eligible.toString(),
      unpricedLots: m?.unpricedLots ?? 0,
      knownValueShare: share?.toString() ?? null,
      weightedCost: weighted?.toString() ?? null,
      purchaseValue: moneyValue(selectedPurchases),
      purchaseUnpriced: selectedPurchases.filter((x) => x.unitCost === null)
        .length,
      consumptionValue: moneyValue(current),
      consumptionUnpriced: current.filter((x) => x.unitCost === null).length,
      prices: selectedPurchases.slice().reverse().map(pricePoint),
      priceTotal: selectedPurchases.length,
      priceComparison: {
        previous: reportPrior ? pricePoint(reportPrior) : null,
        current: reportLast ? pricePoint(reportLast) : null,
      },
      priceChangePercent: reportPricePercent?.toString() ?? null,
      priceStatus:
        !reportLast || !reportPrior
          ? "INSUFFICIENT"
          : reportPrior.unitCost!.eq(0)
            ? "ZERO_BASE"
            : "COMPARABLE",
      priceImpact:
        reportLast && reportPrior
          ? reportLast.delta
              .mul(reportLast.unitCost!.minus(reportPrior.unitCost!))
              .toFixed(2)
          : null,
      excessQuantity: excess?.toString() ?? null,
      excessKnownValue: excessValue.toFixed(2),
      idle,
      idleCovered,
      idleKnownValue: idleValue.toFixed(2),
      exposureKnownValue: exposure.toFixed(2),
      limitations,
      planning: {
        horizonDays,
        targetQuantity: target?.toString() ?? null,
        suggestedQuantity: suggestion?.toString() ?? null,
        basis: rate
          ? "DEMAND_AND_MINIMUM"
          : p.minimumKnown && p.minimum.gt(0)
            ? "MINIMUM_ONLY"
            : "INSUFFICIENT",
        estimatedUnitCost: cost?.toString() ?? null,
        priceReference,
        estimatedBudget:
          suggestion && cost !== null ? suggestion.mul(cost).toFixed(2) : null,
        expiryLoss: projection?.expiredQuantity ?? null,
      },
    };
    precise.set(p.id, {
      currentValue: m ? knownStockValue : D(0),
      purchaseValue: moneySum(selectedPurchases),
      consumptionValue: moneySum(current),
      idle: idleValue,
      excess: excessValue,
      exposure,
      budget: suggestion && cost !== null ? suggestion.mul(cost) : D(0),
    });
    results.push(r);
    if (!m) continue;
    const add = (
      rule: string,
      title: string,
      explanation: string,
      priority: AnalysisAlert["priority"] = "MODERATE",
      suffix = "product",
    ) =>
      signals.push({
        identity: `${rule}:${p.id}:${suffix}`,
        productId: p.id,
        productName: p.name,
        category: p.category,
        unit: p.unit,
        lotId: null,
        lotCode: null,
        rule,
        priority,
        title,
        explanation,
        suggestion:
          "Confira os registros, o contexto operacional e eventual sazonalidade antes de decidir. O sinal não comprova irregularidade.",
        deadlineDays: null,
        exposedQuantity: "0",
        knownValue: "0.00",
        partialCost: m.unpricedLots > 0,
        limitations: [
          ...limitations,
          "Critérios do aplicativo; não há modelo de sazonalidade ou garantia de comportamento futuro.",
        ],
        referenceDay,
        revision,
        ruleVersion: RULE_VERSION,
        policyVersion: policy.policyVersion,
      });
    const a = between(usage, detectorFrom, detectorTo),
      b = between(usage, detectorPrevious, shiftDay(detectorFrom, -1));
    const aq = quantity(a),
      bq = quantity(b);
    if (
      covered(detectorPrevious, detectorTo) &&
      a.length >= 3 &&
      b.length >= 3 &&
      bq.gt(0)
    ) {
      const change = aq.minus(bq).div(bq).mul(100);
      if (
        change.abs().gte(config.consumptionChangePercent) &&
        aq.minus(bq).abs().gte(config.minimumChangeQuantity)
      )
        add(
          "CONSUMPTION_CHANGE",
          change.gt(0)
            ? "Consumo recente aumentou"
            : "Consumo recente diminuiu",
          `${detectorFrom} a ${detectorTo}: ${aq} ${p.unit}; período anterior equivalente: ${bq} ${p.unit}; variação ${change.toDecimalPlaces(2)}%. Limite ${config.consumptionChangePercent}%, com ao menos 3 retiradas em cada período. Base integralmente declarada.`,
        );
    }
    if (trend)
      add(
        "CONSUMPTION_TREND",
        "Consumo em aumento progressivo",
        `Três blocos completos de 7 dias, encerrados em ${detectorTo}: ${blocks.join(" → ")} ${p.unit}. Cada bloco cresce pelo menos ${config.trendPercent}%. Conferir contexto sazonal.`,
      );
    if (excess?.gt(0))
      add(
        "EXCESS",
        "Cobertura acima do horizonte desejado",
        `${eligible} ${p.unit} elegíveis; alvo máximo entre mínimo informado e ${config.excessDays} dias à média ${rate!.toDecimalPlaces(4)} ${p.unit}/dia: ${excessTarget!.toDecimalPlaces(3)} ${p.unit}. Excedente estimado: ${excess.toDecimalPlaces(3)} ${p.unit}. Não significa perda confirmada.`,
      );
    if (idle && share?.gte(config.highValuePercent))
      add(
        "HIGH_VALUE_IDLE",
        "Valor relevante sem consumo",
        `${idleValue.toFixed(2)} BRL conhecidos em saldo físico sem consumo há ${policy.inactivityDays} dias cobertos. Produto concentra ${share.toDecimalPlaces(2)}% do valor atual conhecido; limite ${config.highValuePercent}%. Denominador pode ser parcial por falta de custos.`,
        "HIGH",
      );
    if (
      last &&
      prior &&
      dates.get(last.id)! >= detectorFrom &&
      dates.get(last.id)! <= referenceDay &&
      pricePercent &&
      pricePercent.abs().gte(config.priceChangePercent)
    )
      add(
        "PRICE_CHANGE",
        "Preço de aquisição mudou",
        `Aquisições comparáveis em ${dates.get(prior.id)} e ${dates.get(last.id)}: ${prior.unitCost} → ${last.unitCost} BRL/${p.unit}, variação ${pricePercent.toDecimalPlaces(2)}%. Limite ${config.priceChangePercent}%. Impacto comparativo da última quantidade: ${last.delta.mul(last.unitCost!.minus(prior.unitCost!)).toFixed(2)} BRL; não é perda comprovada.`,
      );
    // Janela anterior de 30 dias, até 200 retiradas anteriores, sem incluir o próprio evento.
    const history: StockMovement[] = [];
    for (const event of usage) {
      const eventDay = dates.get(event.id)!;
      if (
        eventDay >= detectorFrom &&
        eventDay <= referenceDay &&
        covered(shiftDay(eventDay, -30), shiftDay(eventDay, -1))
      ) {
        const sample = history
          .filter((x) => dates.get(x.id)! >= shiftDay(eventDay, -30))
          .slice(-200);
        if (sample.length >= config.withdrawalMinSamples) {
          const center = median(sample.map((x) => x.delta.abs())),
            deviation = median(
              sample.map((x) => x.delta.abs().minus(center).abs()),
            );
          const threshold = Prisma.Decimal.max(
            center.mul(config.withdrawalMultiplier),
            center.plus(deviation.mul(3)),
          );
          if (
            event.delta.abs().gt(threshold) &&
            event.delta.abs().minus(center).gte(config.minimumChangeQuantity)
          ) {
            const explanation = `Retirada ${event.delta.abs()} ${p.unit} em ${eventDay}; mediana anterior ${center} ${p.unit}, limite máximo entre ${config.withdrawalMultiplier}×mediana e mediana + 3×desvio absoluto mediano: ${threshold} ${p.unit}; ${sample.length} retiradas anteriores na janela de 30 dias, sem o próprio evento.`;
            anomalies.push({
              movementId: event.id,
              productId: p.id,
              productName: p.name,
              unit: p.unit,
              day: eventDay,
              quantity: event.delta.abs().toString(),
              median: center.toString(),
              threshold: threshold.toString(),
              samples: sample.length,
              destination: event.destination,
              explanation,
            });
            add(
              "UNUSUAL_WITHDRAWAL",
              "Retirada acima da referência recente",
              explanation,
              "HIGH",
              event.id,
            );
          }
        }
      }
      history.push(event);
      if (history.length > 200) history.shift();
    }
  }
  const categories = new Map<
    string,
    {
      category: string;
      currentValue: Prisma.Decimal;
      purchaseValue: Prisma.Decimal;
      consumptionValue: Prisma.Decimal;
    }
  >();
  for (const p of results) {
    const c = categories.get(p.category) ?? {
      category: p.category,
      currentValue: D(0),
      purchaseValue: D(0),
      consumptionValue: D(0),
    };
    c.currentValue = c.currentValue.plus(precise.get(p.id)!.currentValue);
    c.purchaseValue = c.purchaseValue.plus(precise.get(p.id)!.purchaseValue);
    c.consumptionValue = c.consumptionValue.plus(
      precise.get(p.id)!.consumptionValue,
    );
    categories.set(p.category, c);
  }
  return {
    referenceDay,
    timezone,
    revision,
    policyVersion: policy.policyVersion,
    ruleVersion: RULE_VERSION,
    period: {
      from,
      to,
      previousFrom,
      previousTo,
      days,
      grouping: options.grouping ?? "DAY",
    },
    policy: config,
    products: results,
    signals,
    anomalies: anomalies.sort(
      (a, b) =>
        b.day.localeCompare(a.day) || a.movementId.localeCompare(b.movementId),
    ),
    summary: {
      currentValue: sum(
        results.map((p) => precise.get(p.id)!.currentValue),
      ).toFixed(2),
      purchaseValue: sum(
        results.map((p) => precise.get(p.id)!.purchaseValue),
      ).toFixed(2),
      consumptionValue: sum(
        results.map((p) => precise.get(p.id)!.consumptionValue),
      ).toFixed(2),
      purchaseUnpriced: results.reduce((s, p) => s + p.purchaseUnpriced, 0),
      consumptionUnpriced: results.reduce(
        (s, p) => s + p.consumptionUnpriced,
        0,
      ),
      unpricedLots: results.reduce((s, p) => s + p.unpricedLots, 0),
      idleKnownValue: sum(results.map((p) => precise.get(p.id)!.idle)).toFixed(
        2,
      ),
      excessKnownValue: sum(
        results.map((p) => precise.get(p.id)!.excess),
      ).toFixed(2),
      exposureKnownValue: sum(
        results.map((p) => precise.get(p.id)!.exposure),
      ).toFixed(2),
      estimatedBudget: sum(
        results.map((p) => precise.get(p.id)!.budget),
      ).toFixed(2),
      budgetMissingProducts: results.filter(
        (p) =>
          p.planning.suggestedQuantity &&
          D(p.planning.suggestedQuantity).gt(0) &&
          p.planning.estimatedBudget === null,
      ).length,
      products: results.length,
    },
    categories: [...categories.values()]
      .map((c) => ({
        category: c.category,
        currentValue: c.currentValue.toFixed(2),
        purchaseValue: c.purchaseValue.toFixed(2),
        consumptionValue: c.consumptionValue.toFixed(2),
      }))
      .sort(
        (a, b) =>
          D(b.currentValue).cmp(a.currentValue) ||
          a.category.localeCompare(b.category),
      ),
    assumptions: [
      "Históricos são retificados pelos estornos conhecidos nesta consulta; não recriam automaticamente o que era conhecido na época.",
      "Saldo e valor de estoque são atuais; consumo, aquisições e suas tabelas seguem o período selecionado.",
      "Valores conhecidos em BRL, sem comprovação de pagamento, lucro ou fluxo de caixa. Custos ausentes permanecem ausentes.",
      "Nenhuma entrada futura agendada: o aplicativo ainda não mantém pedidos confirmados. Reposição simulada não é pedido.",
      "Detectores usam suas janelas fixadas na política, encerradas ontem; retiradas individuais incluem registros de hoje. Os filtros não alteram os alertas persistidos.",
      "Sem ajuste sazonal: os sinais orientam conferência. Quantidades de unidades diferentes nunca são somadas.",
    ],
  };
}

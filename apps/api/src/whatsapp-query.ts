import type { Tx } from "./stock-service";
import type { Property } from "./generated/prisma/client";
import { Prisma } from "./generated/prisma/client";
import { dateKey, RULE_VERSION } from "./analysis-common";
import type { AnalysisResult } from "../../../packages/contracts/src/index";
const normal = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export const whatsappHelp = "Posso consultar seu estoque por texto ou mensagem de voz. Exemplos: Quanto diesel temos? O que está abaixo do mínimo? O que está perto de vencer? Qual a autonomia do diesel? Também registro saídas: Retirei 20 litros de diesel (peço confirmação). Para desvincular o número, envie: desvincular.";

export async function whatsappAnswer(tx: Tx, property: Property, text: string) {
  const q = normal(text).slice(0, 1500);
  if (/\b(retir|retira|retire|saida|registre|registrar|adicione|entrada|descarte|estorne|baixe)\w*/.test(q)) return "Esta versão permite consultas. Para registrar uma movimentação, use o painel do AgroMind; nenhuma alteração foi feita.";
  if (/^(oi|ola|bom dia|boa tarde|boa noite|ajuda|menu)[!.? ]*$/.test(q)) return whatsappHelp;
  if (/^quais produtos temos/.test(q)) {
    const all = await tx.product.findMany({ where: { propertyId: property.id, archived: false }, orderBy: { name: "asc" }, take: 501 });
    if (!all.length) return `A propriedade ${property.name} ainda não tem produtos cadastrados.`;
    return `${property.name} — ${all.length > 500 ? "mais de 500" : all.length} produto(s) cadastrado(s):\n${all.slice(0, 15).map(p => `• ${p.name}`).join("\n")}${all.length > 15 ? "\nLista parcial; veja todos no painel." : ""}\nPergunte, por exemplo: Quanto ${all[0].name} temos?`;
  }
  const summary = /minim|critico|acabando|comprar|repor/.test(q), expiry = /venc|validade/.test(q), autonomy = /autonomia|dura|tempo|consumo/.test(q);
  const products = await tx.product.findMany({ where: { propertyId: property.id, archived: false }, include: { lots: true }, orderBy: { name: "asc" }, take: 501 });
  if (!products.length) return `A propriedade ${property.name} ainda não tem produtos cadastrados.`;
  if (products.length > 500) return "Esta consulta excede o limite de 500 produtos do assistente. Consulte os dados completos no painel.";
  const words = q.replace(/[?!.:,]/g, " ").split(/\s+/).filter(w => w.length > 1);
  const stop = new Set(["de", "do", "da", "dos", "das", "para", "com", "em", "no", "na", "por"]);
  const scored = products.map(p => ({ p, score: normal(p.name).split(/\s+/).filter(w => !stop.has(w) && words.includes(w)).length }));
  const max = Math.max(...scored.map(s => s.score));
  const matches = max ? scored.filter(s => s.score === max).map(s => s.p) : [];
  const targeted = matches.length > 0;
  if (targeted && matches.length > 1) return `Encontrei mais de um produto. Repita a pergunta com o nome completo:\n${matches.slice(0, 8).map(p => `• ${p.name}`).join("\n")}${matches.length > 8 ? "\nVeja os demais no painel." : ""}`;
  if (!summary && !expiry && !targeted) return whatsappHelp;
  if (autonomy && !targeted) return "Informe o nome do produto. Exemplo: Qual a autonomia do diesel?";
  const referenceDay = dateKey(new Date(), property.timezone);
  if (summary || autonomy) {
    const snapshot = await tx.analysisSnapshot.findUnique({ where: { propertyId_revision_policyVersion_referenceDay_ruleVersion: { propertyId: property.id, revision: property.inventoryRevision, policyVersion: property.policyVersion, referenceDay, ruleVersion: RULE_VERSION } } });
    if (!snapshot || property.analysisPending || property.analysisError) return "As análises estão sendo atualizadas. Tente novamente em instantes ou confira o estado do processamento no painel.";
    const result = snapshot.result as unknown as AnalysisResult;
    if (summary && !targeted) {
      const items = result.alerts.filter(a => a.rule === "MINIMUM");
      return `${property.name} — abaixo do mínimo (${referenceDay}):\n${items.length ? items.slice(0, 8).map(a => { const p = result.products.find(p => p.id === a.productId); return `• ${p?.name}: ${p?.eligible} ${p?.unit} elegíveis; mínimo ${p?.minimum} ${p?.unit}`; }).join("\n") : "Nenhum produto com mínimo informado está abaixo do limite."}${items.length > 8 ? "\nLista parcial; consulte todos no painel." : ""}\nMínimos não informados não são tratados como zero.`;
    }
    if (autonomy) {
      const p = result.products.find(p => p.id === matches[0].id);
      if (!p || p.autonomyDays === null) return `${matches[0].name}: não há histórico suficiente e confirmado para estimar autonomia. Confira a cobertura do histórico no painel.`;
      return `${property.name} — ${p.name}\nAutonomia estimada: ${p.autonomyDays} dias.\nSaldo elegível: ${p.eligible} ${p.unit}; média: ${p.dailyAverage} ${p.unit}/dia.\nHistórico: ${p.from} a ${p.to}.\n${p.limitations.slice(0, 3).join(" ")} A estimativa não garante consumo futuro.`;
    }
  }
  if (expiry) {
    const candidates = targeted ? matches : products;
    const through = new Date(referenceDay); through.setUTCDate(through.getUTCDate() + property.expiryWarningDays);
    const end = through.toISOString().slice(0, 10);
    const lots = candidates.flatMap(p => p.lots.filter(l => l.balance.gt(0) && l.expiryStatus === "DATED" && l.expiresOn && l.expiresOn.toISOString().slice(0, 10) <= end).map(l => ({ p, l })));
    lots.sort((a, b) => a.l.expiresOn!.getTime() - b.l.expiresOn!.getTime());
    return `${property.name} — validade até ${end}:\n${lots.length ? lots.slice(0, 8).map(({ p, l }) => `• ${p.name}, lote ${l.code}: ${l.balance} ${p.unit}, ${l.expiresOn!.toISOString().slice(0, 10)}${l.expiresOn!.toISOString().slice(0, 10) < referenceDay ? " (vencido)" : ""}`).join("\n") : "Nenhum lote com validade informada nesse intervalo."}${lots.length > 8 ? "\nLista parcial; veja todos no painel." : ""}\nValidade desconhecida precisa ser conferida.`;
  }
  const p = matches[0];
  const physical = p.lots.reduce((n, l) => n.plus(l.balance), new Prisma.Decimal(0));
  const eligible = p.lots.filter(l => l.expiryStatus === "NA" || (l.expiryStatus === "DATED" && l.expiresOn && l.expiresOn.toISOString().slice(0, 10) >= referenceDay)).reduce((n, l) => n.plus(l.balance), new Prisma.Decimal(0));
  return `${property.name} — ${p.name}\nSaldo físico: ${physical} ${p.unit}.\nSaldo elegível conhecido: ${eligible} ${p.unit}.\nMínimo: ${p.minimumKnown ? `${p.minimum} ${p.unit}` : "não informado"}.\nLotes vencidos ou com validade desconhecida não entram no saldo elegível.`;
}

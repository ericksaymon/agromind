import { Prisma } from "./generated/prisma/client";
import type { Property, User, WhatsappConnection } from "./generated/prisma/client";
import { audit } from "./administration-service";
import { dateKey } from "./analysis-common";
import { decryptWhatsapp, encryptWhatsapp } from "./whatsapp-crypto";
import { applyMovement, bump, checkTimeline, checkUnitQuantity, decimal, type Tx } from "./stock-service";
import type { Movement } from "./whatsapp-intent";

type Connection = WhatsappConnection & { user: User; property: Property };
type Payload = { productId: string; productName: string; unit: string; lotId: string; lotCode: string; quantity: string; before: string; destination: string };
const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const CONFIRM_MINUTES = 10;
const pendingText = "Responda SIM para confirmar ou NÃO para cancelar. Vale por dez minutos.";
export const wantsDisconnect = (text: string) => normal(text).length <= 60 && /\b(desconectar|desvincular|desligar)\b/.test(normal(text));
export const isConfirm = (text: string) => /^(sim|confirmo|confirmar)[!. ]*$/.test(normal(text));
export const isCancel = (text: string) => /^(nao|cancelar|cancela)[!. ]*$/.test(normal(text));

// Erros de regra de negócio (4xx) viram mensagem ao usuário; qualquer outro erro desfaz a transação e é tentado de novo.
const explain = (error: unknown) => {
  const e = error as { statusCode?: number; message?: string };
  if (e?.statusCode && e.statusCode < 500 && e.message) return `Não foi possível registrar: ${e.message} Nenhuma alteração foi feita.`;
  throw error;
};
const savePending = (tx: Tx, c: Connection, kind: string, payload: unknown) => {
  const data = { connectionVersion: c.version, kind, encrypted: encryptWhatsapp(payload), expiresAt: new Date(Date.now() + CONFIRM_MINUTES * 60_000), createdAt: new Date() };
  return tx.whatsappPendingAction.upsert({ where: { connectionId: c.id }, create: { connectionId: c.id, ...data }, update: data });
};
const role = async (tx: Tx, c: Connection) => (await tx.membership.findUnique({ where: { userId_propertyId: { userId: c.userId, propertyId: c.propertyId } } }))?.role;

// Prepara uma saída de estoque e pede confirmação; nada é gravado no estoque até o SIM digitado.
export async function proposeMovement(tx: Tx, c: Connection, movement: Movement | null) {
  const level = await role(tx, c);
  if (!level || level === "VIEWER") return "Seu acesso permite apenas consultar o estoque; nenhuma alteração foi feita.";
  if (!movement || movement.kind === "OTHER") return "Para registrar uma saída, diga o produto e a quantidade. Exemplo: Retirei 20 litros de diesel para o trator. Nenhuma alteração foi feita.";
  if (movement.kind !== "OUT") return "Pelo WhatsApp só registro saídas de estoque. Entradas, perdas e ajustes são feitos no painel do AgroMind; nenhuma alteração foi feita.";
  if (!movement.product || !movement.quantity) return "Não consegui identificar o produto e a quantidade na mesma unidade do cadastro. Diga, por exemplo: Retirei 20 litros de diesel. Nenhuma alteração foi feita.";
  const product = await tx.product.findFirst({ where: { propertyId: c.propertyId, name: movement.product, archived: false }, include: { lots: true } });
  if (!product) return "Não encontrei esse produto. Nenhuma alteração foi feita.";
  try {
    const qty = decimal(movement.quantity, "Quantidade", 3, false);
    checkUnitQuantity(product.unit, qty);
    const today = dateKey(new Date(), c.property.timezone);
    const usable = product.lots.filter(l => l.balance.gt(0) && (l.expiryStatus === "NA" || (l.expiryStatus === "DATED" && !!l.expiresOn && l.expiresOn.toISOString().slice(0, 10) >= today)))
      .sort((a, b) => (a.expiresOn?.getTime() ?? Infinity) - (b.expiresOn?.getTime() ?? Infinity) || a.code.localeCompare(b.code));
    const total = usable.reduce((n, l) => n.plus(l.balance), new Prisma.Decimal(0));
    if (total.lt(qty)) return `Saldo insuficiente de ${product.name}: ${total} ${product.unit} utilizáveis (lotes vencidos ou de validade desconhecida não contam). Nenhuma alteração foi feita.`;
    const lot = usable.find(l => l.balance.gte(qty));
    if (!lot) return `O saldo de ${product.name} está dividido entre lotes e nenhum cobre ${qty} ${product.unit}. Registre pelo painel, escolhendo os lotes. Nenhuma alteração foi feita.`;
    const destination = movement.destination || "Não informado (WhatsApp)";
    await savePending(tx, c, "MOVEMENT", { productId: product.id, productName: product.name, unit: product.unit, lotId: lot.id, lotCode: lot.code, quantity: qty.toString(), before: lot.balance.toString(), destination } satisfies Payload);
    return `Registrar saída de ${qty} ${product.unit} de ${product.name}?\nLote ${lot.code}${lot.expiresOn ? ` (validade ${lot.expiresOn.toISOString().slice(0, 10)})` : ""}: saldo ${lot.balance} → ${lot.balance.minus(qty)} ${product.unit}.\nDestino: ${destination}.\n${pendingText}`;
  } catch (error) { return explain(error); }
}

export async function proposeDisconnect(tx: Tx, c: Connection) {
  await savePending(tx, c, "DISCONNECT", {});
  return `Desvincular o número com final ${c.lastDigits} do AgroMind? Você deixará de consultar o estoque por aqui até conectar de novo.\n${pendingText}`;
}

export async function cancelPending(tx: Tx, c: Connection) {
  const found = await tx.whatsappPendingAction.deleteMany({ where: { connectionId: c.id } });
  return found.count ? "Cancelado. Nenhuma alteração foi feita." : "Não há nada aguardando confirmação.";
}

// Confirmação digitada: aplica a pendência pela mesma função de movimentação do painel.
export async function confirmPending(tx: Tx, c: Connection, eventKey: string) {
  const pending = await tx.whatsappPendingAction.findUnique({ where: { connectionId: c.id } });
  if (!pending) return { response: "Não há nada aguardando confirmação.", unlinked: false };
  await tx.whatsappPendingAction.delete({ where: { id: pending.id } });
  if (pending.expiresAt <= new Date() || pending.connectionVersion !== c.version) return { response: "Esse pedido expirou. Envie-o de novo, se ainda quiser.", unlinked: false };
  const actor = { userId: c.userId, user: { name: c.user.name } };
  if (pending.kind === "DISCONNECT") {
    await tx.whatsappPairCode.updateMany({ where: { session: { userId: c.userId }, usedAt: null }, data: { usedAt: new Date() } });
    await tx.whatsappReply.updateMany({ where: { connectionId: c.id, status: "QUEUED" }, data: { status: "CANCELED", encrypted: "" } });
    await tx.whatsappConnection.delete({ where: { id: c.id } });
    await audit(tx, actor, c.propertyId, "WHATSAPP_DISCONNECTED", "Desconexão pedida pelo próprio WhatsApp", { lastDigits: c.lastDigits });
    return { response: "Número desvinculado. Para voltar a consultar, gere um novo código em Assistente no painel.", unlinked: true };
  }
  const level = await role(tx, c);
  if (!level || level === "VIEWER") return { response: "Seu acesso permite apenas consultar o estoque; nenhuma alteração foi feita.", unlinked: false };
  const data = decryptWhatsapp<Payload>(pending.encrypted);
  await tx.$queryRaw`SELECT id FROM "Property" WHERE id=${c.propertyId}::uuid FOR UPDATE`;
  const lot = await tx.stockLot.findFirst({ where: { id: data.lotId, productId: data.productId } });
  if (!lot || !lot.balance.eq(data.before)) return { response: "O saldo desse lote mudou desde o pedido. Envie a retirada de novo para conferir os números. Nenhuma alteração foi feita.", unlinked: false };
  try {
    const property = await tx.property.findUniqueOrThrow({ where: { id: c.propertyId } });
    const movement = await applyMovement(tx, { userId: c.userId, name: c.user.name, role: level, propertyId: c.propertyId, timezone: property.timezone }, { productId: data.productId, lotId: data.lotId, kind: "CONSUMPTION", quantity: data.quantity, occurredAt: new Date().toISOString(), destination: data.destination, notes: "Registrado pelo WhatsApp" }, `wa-${eventKey}`.slice(0, 100), "WHATSAPP", undefined, undefined, false);
    try { await checkTimeline(tx, data.lotId); }
    catch (error) {
      // A conferência do histórico roda depois da gravação; desfaz aqui para a recusa não deixar a baixa pela metade.
      await tx.stockMovement.delete({ where: { id: movement.id } });
      await tx.stockLot.update({ where: { id: data.lotId }, data: { balance: { increment: data.quantity } } });
      throw error;
    }
    await bump(tx, c.propertyId);
    await audit(tx, actor, c.propertyId, "WHATSAPP_MOVEMENT", "Saída confirmada pelo WhatsApp", { product: data.productName, quantity: data.quantity, lot: data.lotCode });
    return { response: `Saída registrada: ${data.quantity} ${data.unit} de ${data.productName}, lote ${data.lotCode}. Saldo do lote: ${new Prisma.Decimal(data.before).minus(data.quantity)} ${data.unit}.\nPara desfazer, use o painel.`, unlinked: false };
  } catch (error) { return { response: explain(error), unlinked: false }; }
}

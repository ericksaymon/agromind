import { Prisma } from "./generated/prisma/client";
import type { FastifyRequest } from "fastify";
import { db } from "./db";
import { failure, requireMembership, digest } from "./security";
import { currentSession } from "./administration-service";
import {
  stockUnits,
  type ProductInput,
  type MovementInput,
  type ProductView,
  type StockKind,
} from "../../../packages/contracts/src/index";
export type Tx = Prisma.TransactionClient;
export type Actor = {
  sessionId?: string;
  userId: string;
  name: string;
  role: string;
  propertyId: string;
  timezone: string;
};
export const keyOf = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export const dec = (v: string | number | Prisma.Decimal) =>
  new Prisma.Decimal(v);
export function decimal(
  value: string,
  label = "Quantidade",
  scale = 3,
  zero = true,
) {
  if (!/^\d+(\.\d+)?$/.test(value) || value.length > 22)
    failure(
      400,
      `${label}: informe um número positivo, com ponto decimal e sem separador de milhar.`,
    );
  const d = dec(value);
  if (d.decimalPlaces() > scale || d.gt("999999999999") || (!zero && d.lte(0)))
    failure(
      400,
      `${label}: use até ${scale} casas decimais${zero ? "" : " e valor maior que zero"}.`,
    );
  return d;
}
export function dayInZone(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function validDay(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function occurrence(value: string, timezone: string) {
  let date: Date;
  if (validDay(value)) {
    // Data sem hora é preservada como início do dia local; a hora de cadastro fica em recordedAt.
    let guess = Date.parse(value + "T00:00:00Z");
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longOffset",
    });
    const offset =
      fmt.formatToParts(new Date(guess)).find((p) => p.type === "timeZoneName")
        ?.value || "GMT";
    const m = offset.match(/GMT([+-])(\d\d):(\d\d)/);
    if (m)
      guess -=
        (m[1] === "+" ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3])) * 60000;
    date = new Date(guess);
  } else {
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value) ||
      !validDay(value.slice(0, 10))
    )
      failure(
        400,
        "Informe uma data válida (AAAA-MM-DD) ou um horário ISO UTC.",
      );
    date = new Date(value);
  }
  if (
    isNaN(date.getTime()) ||
    date.getUTCFullYear() < 1900 ||
    dayInZone(date, timezone) > dayInZone(new Date(), timezone) ||
    (value.includes("T") && date.getTime() > Date.now() + 30000)
  )
    failure(
      400,
      "A data do fato não pode estar no futuro ou ser anterior a 1900.",
    );
  return date;
}
export async function stockActor(
  request: FastifyRequest,
  propertyId: string,
  write = false,
): Promise<Actor> {
  const { session, membership } = await requireMembership(request, propertyId);
  if (write && membership.role === "VIEWER")
    failure(403, "Seu acesso permite apenas consultar o estoque.", "FORBIDDEN");
  return {
    sessionId: session.id,
    userId: session.userId,
    name: session.user.name,
    role: membership.role,
    propertyId,
    timezone: membership.property.timezone,
  };
}
export async function locked<T>(
  actor: Actor,
  fn: (tx: Tx, revision: number) => Promise<T>,
) {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Property" WHERE id=${actor.propertyId}::uuid FOR UPDATE`;
      if (actor.sessionId) {
        const fresh = await currentSession(tx, { id: actor.sessionId, userId: actor.userId }, true);
        actor.name = fresh.user.name;
      }
      const membership = await tx.membership.findUnique({
        where: {
          userId_propertyId: {
            userId: actor.userId,
            propertyId: actor.propertyId,
          },
        },
      });
      if (!membership || membership.role === "VIEWER")
        failure(403, "Você não pode alterar este estoque.", "FORBIDDEN");
      actor.role = membership.role;
      const p = await tx.property.findUniqueOrThrow({
        where: { id: actor.propertyId },
      });
      actor.timezone = p.timezone;
      return fn(tx, p.inventoryRevision);
    },
    { maxWait: 15000, timeout: 60000 },
  );
}
export function sameRevision(actual: number, expected: number) {
  if (actual !== expected)
    failure(
      409,
      "O estoque mudou desde sua conferência. Atualize os dados e revise novamente.",
      "STALE_PREVIEW",
    );
}
export async function bump(tx: Tx, propertyId: string) {
  await tx.property.update({
    where: { id: propertyId },
    data: { inventoryRevision: { increment: 1 }, analysisPending: true },
  });
}
export async function replay(
  tx: Tx,
  propertyId: string,
  key: string,
  body: unknown,
) {
  const previous = await tx.stockRequest.findUnique({
    where: { propertyId_key: { propertyId, key } },
  });
  const hash = digest(JSON.stringify(body));
  if (previous && previous.hash !== hash)
    failure(
      409,
      "Identificador de operação já utilizado com outros dados.",
      "KEY_REUSED",
    );
  return { hash, result: previous?.result };
}
export async function remember(
  tx: Tx,
  propertyId: string,
  key: string,
  hash: string,
  result: unknown,
) {
  await tx.stockRequest.create({
    data: { propertyId, key, hash, result: result as Prisma.InputJsonValue },
  });
}
export async function productIn(tx: Tx, propertyId: string, id: string) {
  const product = await tx.product.findFirst({
    where: { id, propertyId },
    include: { lots: true },
  });
  if (!product) failure(404, "Produto não encontrado.", "NOT_FOUND");
  return product;
}
export function cleanProduct(input: ProductInput) {
  const name = input.name.trim(),
    category = input.category.trim();
  if (
    name.length < 2 ||
    name.length > 120 ||
    category.length < 2 ||
    category.length > 80 ||
    !stockUnits.includes(input.unit as (typeof stockUnits)[number])
  )
    failure(400, "Confira nome, categoria e unidade do produto.");
  return {
    name,
    nameKey: keyOf(name),
    category,
    unit: input.unit,
    minimum: decimal(input.minimum, "Estoque mínimo"),
    minimumKnown: input.minimumKnown ?? true,
  };
}
export function checkUnitQuantity(unit: string, value: Prisma.Decimal) {
  if (unit === "un" && !value.isInteger())
    failure(400, "Produtos em unidades (un) exigem quantidade inteira.");
}
export async function createProduct(tx: Tx, actor: Actor, input: ProductInput) {
  const data = cleanProduct(input);
  checkUnitQuantity(data.unit, data.minimum);
  if (
    await tx.product.findUnique({
      where: {
        propertyId_nameKey: {
          propertyId: actor.propertyId,
          nameKey: data.nameKey,
        },
      },
    })
  )
    failure(
      409,
      "Já existe um produto com esse nome. Associe o registro ao produto existente.",
      "DUPLICATE_PRODUCT",
    );
  const words = data.nameKey.split(" ").filter((w) => w.length > 2);
  const candidates = await tx.product.findMany({
    where: { propertyId: actor.propertyId },
    select: { name: true, nameKey: true },
  });
  const similar = candidates.filter((p) =>
    words.some((w) => p.nameKey.split(" ").includes(w)),
  );
  if (similar.length && !input.acknowledgeSimilar)
    failure(
      409,
      `Confira possíveis produtos semelhantes: ${similar
        .slice(0, 4)
        .map((p) => p.name)
        .join(", ")}. Confirme que é um produto diferente para continuar.`,
      "SIMILAR_PRODUCT",
    );
  const category = await resolveCategory(tx, actor.propertyId, input.category, input.categoryId);
  return tx.product.create({ data: { ...data, category: category.name, categoryId: category.id, propertyId: actor.propertyId } });
}
export async function applyMovement(
  tx: Tx,
  actor: Actor,
  input: MovementInput,
  requestKey: string,
  source = "WEB",
  importBatchId?: string,
  fingerprint?: string,
  validateTimeline = true,
) {
  const product = await productIn(tx, actor.propertyId, input.productId);
  if (product.archived)
    failure(400, "Reative o produto antes de registrar uma movimentação.");
  const qty = decimal(input.quantity, "Quantidade", 3, false);
  checkUnitQuantity(product.unit, qty);
  const when = occurrence(input.occurredAt, actor.timezone);
  if (
    ["ADJUST_IN", "ADJUST_OUT"].includes(input.kind) &&
    actor.role !== "ADMIN"
  )
    failure(403, "Somente administradores podem ajustar saldos.", "FORBIDDEN");
  if (
    ["DISPOSAL", "ADJUST_IN", "ADJUST_OUT"].includes(input.kind) &&
    !(input.notes || "").trim()
  )
    failure(400, "Informe o motivo da perda ou ajuste.");
  if (input.kind === "CONSUMPTION" && !(input.destination || "").trim())
    failure(400, "Informe o destino da retirada.");
  let lot = input.lotId
    ? await tx.stockLot.findFirst({
        where: { id: input.lotId, productId: product.id },
      })
    : null;
  if (input.lotId && !lot) failure(404, "Lote não encontrado.");
  if (!lot) {
    if (!["OPENING", "IN", "ADJUST_IN"].includes(input.kind))
      failure(400, "Selecione o lote da retirada.");
    const data = input.lot;
    if (!data?.code.trim() || data.code.trim().length > 80)
      failure(400, "Informe um código para o lote.");
    if (
      data.expiryStatus === "DATED" &&
      (!data.expiresOn || !validDay(data.expiresOn))
    )
      failure(400, "Informe a validade completa do lote.");
    if (
      await tx.stockLot.findUnique({
        where: {
          productId_code: { productId: product.id, code: data.code.trim() },
        },
      })
    )
      failure(409, "Este lote já existe. Selecione-o ou informe outro código.");
    const cost = data.unitCost?.trim()
      ? decimal(data.unitCost, "Custo unitário", 4)
      : null;
    lot = await tx.stockLot.create({
      data: {
        productId: product.id,
        code: data.code.trim(),
        expiryStatus: data.expiryStatus,
        expiresOn:
          data.expiryStatus === "DATED" ? new Date(data.expiresOn!) : null,
        unitCost: cost,
        supplier: data.supplier?.trim() || null,
      },
    });
  } else {
    if (
      input.lot?.unitCost &&
      !lot.unitCost?.eq(decimal(input.lot.unitCost, "Custo unitário", 4))
    )
      failure(
        400,
        "Preço diferente exige um novo lote para preservar o custo de aquisição.",
      );
    if (input.lot?.supplier && input.lot.supplier !== lot.supplier)
      failure(400, "Fornecedor diferente exige outro lote.");
    if (
      input.lot?.expiryStatus === "DATED" &&
      input.lot.expiresOn !== lot.expiresOn?.toISOString().slice(0, 10)
    )
      failure(400, "Validade diferente exige outro lote.");
    if (input.lot?.expiryStatus === "NA" && lot.expiryStatus !== "NA")
      failure(400, "O lote existente tem outra condição de validade.");
  }
  if (
    input.kind === "OPENING" &&
    (await tx.stockMovement.count({ where: { lotId: lot.id } }))
  )
    failure(
      400,
      "O lote já tem histórico. Registre entrada ou ajuste; não repita a abertura.",
    );
  const negative = ["CONSUMPTION", "DISPOSAL", "ADJUST_OUT"].includes(
    input.kind,
  );
  if (
    input.kind === "CONSUMPTION" &&
    lot.expiresOn &&
    lot.expiresOn.toISOString().slice(0, 10) < dayInZone(when, actor.timezone)
  )
    failure(
      400,
      "Lote vencido: saída para uso bloqueada. Para descarte, selecione perda / descarte.",
      "EXPIRED_LOT",
    );
  const delta = negative ? qty.negated() : qty;
  if (lot.balance.plus(delta).lt(0))
    failure(
      409,
      "Saldo insuficiente no lote selecionado.",
      "INSUFFICIENT_STOCK",
    );
  const movement = await tx.stockMovement.create({
    data: {
      productId: product.id,
      lotId: lot.id,
      kind: input.kind,
      delta,
      unitCost: lot.unitCost,
      occurredAt: when,
      actorId: actor.userId,
      actorName: actor.name,
      originalResponsible: input.originalResponsible?.trim() || null,
      originalReference: input.originalReference?.trim() || null,
      originalLine: input.originalLine,
      consumptionConfirmed: input.consumptionConfirmed ?? true,
      destination: input.destination?.trim() || null,
      notes: input.notes?.trim() || null,
      source,
      requestKey,
      importBatchId,
      fingerprint,
    },
  });
  await tx.stockLot.update({
    where: { id: lot.id },
    data: { balance: { increment: delta } },
  });
  if (validateTimeline) await checkTimeline(tx, lot.id);
  return movement;
}
export async function checkTimeline(tx: Tx, lotId: string) {
  const rows = await tx.stockMovement.findMany({
    where: { lotId },
    orderBy: [{ occurredAt: "asc" }, { sequence: "asc" }],
  });
  let sum = dec(0);
  for (const row of rows) {
    sum = sum.plus(row.delta);
    if (sum.lt(0))
      failure(
        409,
        "Esta data deixaria um saldo negativo no histórico do lote. Confira as datas de abertura e movimentação.",
        "INVALID_TIMELINE",
      );
  }
}
export async function reverseMovement(
  tx: Tx,
  actor: Actor,
  id: string,
  notes: string,
  requestKey: string,
) {
  if (actor.role !== "ADMIN")
    failure(
      403,
      "Somente administradores podem estornar movimentos.",
      "FORBIDDEN",
    );
  if (!notes.trim()) failure(400, "Informe o motivo do estorno.");
  const original = await tx.stockMovement.findFirst({
    where: { id, product: { propertyId: actor.propertyId } },
    include: { lot: true },
  });
  if (!original) failure(404, "Movimentação não encontrada.");
  if (
    original.kind === "REVERSAL" ||
    (await tx.stockMovement.count({ where: { reversalOf: id } }))
  )
    failure(409, "Este movimento já foi estornado ou é um estorno.");
  const delta = original.delta.negated();
  if (original.lot.balance.plus(delta).lt(0))
    failure(
      409,
      "Este estorno deixaria o lote com saldo negativo. Revise as movimentações posteriores.",
    );
  const movement = await tx.stockMovement.create({
    data: {
      productId: original.productId,
      lotId: original.lotId,
      kind: "REVERSAL",
      delta,
      unitCost: original.unitCost,
      occurredAt: new Date(),
      actorId: actor.userId,
      actorName: actor.name,
      notes,
      source: "WEB",
      requestKey,
      reversalOf: id,
    },
  });
  await tx.stockLot.update({
    where: { id: original.lotId },
    data: { balance: { increment: delta } },
  });
  await checkTimeline(tx, original.lotId);
  return movement;
}
export function productView(
  p: Awaited<ReturnType<typeof productIn>>,
): ProductView {
  let balance = dec(0),
    known = dec(0),
    unpriced = dec(0);
  for (const lot of p.lots) {
    balance = balance.plus(lot.balance);
    if (lot.unitCost !== null)
      known = known.plus(lot.balance.mul(lot.unitCost));
    else unpriced = unpriced.plus(lot.balance);
  }
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    categoryId: p.categoryId,
    unit: p.unit,
    minimum: p.minimum.toString(),
    minimumKnown: p.minimumKnown,
    archived: p.archived,
    balance: balance.toString(),
    knownValue: known.toFixed(2),
    unpricedBalance: unpriced.toString(),
    lots: p.lots
      .map((l) => ({
        id: l.id,
        code: l.code,
        balance: l.balance.toString(),
        unitCost: l.unitCost?.toString() ?? null,
        supplier: l.supplier,
        expiresOn: l.expiresOn?.toISOString().slice(0, 10) ?? null,
        expiryStatus: l.expiryStatus,
      }))
      .sort((a, b) =>
        (a.expiresOn || "9999").localeCompare(b.expiresOn || "9999"),
      ),
  };
}

export async function resolveCategory(tx: Tx, propertyId: string, name: string, categoryId?: string, currentCategoryId?: string) {
  const category = categoryId ? await tx.category.findFirst({ where: { id: categoryId, propertyId } }) : await tx.category.findUnique({ where: { propertyId_nameKey: { propertyId, nameKey: keyOf(name) } } });
  if (!category || (category.archived && category.id !== currentCategoryId)) failure(400, "Selecione uma categoria ativa desta propriedade. Peça ao administrador para criar categorias novas.", "CATEGORY_REQUIRED");
  if (categoryId && keyOf(name) !== category.nameKey) failure(409, "A categoria mudou. Recarregue a seleção.", "STALE_CATEGORY");
  return category;
}

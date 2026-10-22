import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { db } from "./db";
import { failure } from "./security";
import {
  applyMovement,
  bump,
  cleanProduct,
  createProduct,
  locked,
  productIn,
  productView,
  remember,
  replay,
  reverseMovement,
  sameRevision,
  stockActor,
  checkUnitQuantity,
} from "./stock-service";
import { registerImportRoutes } from "./stock-import";
const text = (max = 120) => Type.String({ maxLength: max });
const numberText = Type.String({ minLength: 1, maxLength: 22 });
const id = Type.String({ format: "uuid" });
const params = Type.Object({ propertyId: id });
const itemParams = Type.Object({ propertyId: id, id });
const envelope = {
  key: Type.String({ minLength: 8, maxLength: 100 }),
  revision: Type.Integer({ minimum: 0 }),
};
const productFields = {
  name: Type.String({ minLength: 2, maxLength: 120 }),
  category: Type.String({ minLength: 2, maxLength: 80 }),
  unit: text(10),
  minimum: numberText,
  minimumKnown: Type.Optional(Type.Boolean()),
  acknowledgeSimilar: Type.Optional(Type.Boolean()),
};
const productBody = Type.Object(
  { ...envelope, ...productFields },
  { additionalProperties: false },
);
const lotBody = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 80 }),
    expiryStatus: Type.Union([
      Type.Literal("UNKNOWN"),
      Type.Literal("DATED"),
      Type.Literal("NA"),
    ]),
    expiresOn: Type.Optional(text(10)),
    unitCost: Type.Optional(text(22)),
    supplier: Type.Optional(text(120)),
  },
  { additionalProperties: false },
);
const movementBody = Type.Object(
  {
    ...envelope,
    productId: id,
    lotId: Type.Optional(id),
    kind: Type.Union(
      (
        [
          "OPENING",
          "IN",
          "CONSUMPTION",
          "DISPOSAL",
          "ADJUST_IN",
          "ADJUST_OUT",
        ] as const
      ).map((k) => Type.Literal(k)),
    ),
    quantity: numberText,
    occurredAt: text(30),
    destination: Type.Optional(text(120)),
    notes: Type.Optional(text(500)),
    lot: Type.Optional(lotBody),
  },
  { additionalProperties: false },
);
export async function registerStockRoutes(app: FastifyInstance) {
  app.get<{ Params: Static<typeof params> }>(
    "/api/properties/:propertyId/inventory",
    { schema: { params } },
    async (request) => {
      await stockActor(request, request.params.propertyId);
      return db.$transaction(
        async (tx) => {
          const p = await tx.property.findUniqueOrThrow({
            where: { id: request.params.propertyId },
          });
          const products = await tx.product.findMany({
            where: { propertyId: p.id },
            include: { lots: true },
            orderBy: { name: "asc" },
          });
          return {
            revision: p.inventoryRevision,
            products: products.map(productView),
          };
        },
        { isolationLevel: "RepeatableRead" },
      );
    },
  );
  app.get<{ Params: Static<typeof itemParams> }>(
    "/api/properties/:propertyId/products/:id",
    { schema: { params: itemParams } },
    async (request) => {
      await stockActor(request, request.params.propertyId);
      const p = await db.product.findFirst({
        where: { id: request.params.id, propertyId: request.params.propertyId },
        include: { lots: true },
      });
      if (!p) failure(404, "Produto não encontrado.", "NOT_FOUND");
      return productView(p);
    },
  );
  app.post<{ Params: Static<typeof params>; Body: Static<typeof productBody> }>(
    "/api/properties/:propertyId/products",
    { schema: { params, body: productBody } },
    async (request, reply) => {
      const actor = await stockActor(request, request.params.propertyId, true);
      const result = await locked(actor, async (tx, revision) => {
        const previous = await replay(
          tx,
          actor.propertyId,
          request.body.key,
          request.body,
        );
        if (previous.result) return previous.result;
        sameRevision(revision, request.body.revision);
        const p = await createProduct(tx, actor, request.body);
        await bump(tx, actor.propertyId);
        const result = { id: p.id };
        await remember(
          tx,
          actor.propertyId,
          request.body.key,
          previous.hash,
          result,
        );
        return result;
      });
      return reply.code(201).send(result);
    },
  );
  app.post<{
    Params: Static<typeof itemParams>;
    Body: Static<typeof productBody>;
  }>(
    "/api/properties/:propertyId/products/:id/update",
    { schema: { params: itemParams, body: productBody } },
    async (request) => {
      const actor = await stockActor(request, request.params.propertyId, true);
      return locked(actor, async (tx, revision) => {
        const previous = await replay(tx, actor.propertyId, request.body.key, {
          id: request.params.id,
          ...request.body,
        });
        if (previous.result) return previous.result;
        sameRevision(revision, request.body.revision);
        const p = await productIn(tx, actor.propertyId, request.params.id),
          data = cleanProduct(request.body);
        checkUnitQuantity(data.unit, data.minimum);
        if (
          data.unit !== p.unit &&
          (await tx.stockMovement.count({ where: { productId: p.id } }))
        )
          failure(
            400,
            "A unidade base não pode ser alterada após movimentações.",
          );
        if (
          await tx.product.findFirst({
            where: {
              propertyId: actor.propertyId,
              nameKey: data.nameKey,
              id: { not: p.id },
            },
          })
        )
          failure(409, "Já existe um produto com esse nome.");
        await tx.product.update({ where: { id: p.id }, data });
        await bump(tx, actor.propertyId);
        const result = { id: p.id };
        await remember(
          tx,
          actor.propertyId,
          request.body.key,
          previous.hash,
          result,
        );
        return result;
      });
    },
  );
  const archiveBody = Type.Object(
    { ...envelope, archived: Type.Boolean() },
    { additionalProperties: false },
  );
  app.post<{
    Params: Static<typeof itemParams>;
    Body: Static<typeof archiveBody>;
  }>(
    "/api/properties/:propertyId/products/:id/archive",
    { schema: { params: itemParams, body: archiveBody } },
    async (request) => {
      const actor = await stockActor(request, request.params.propertyId, true);
      return locked(actor, async (tx, revision) => {
        if (actor.role !== "ADMIN")
          failure(403, "Somente administradores podem arquivar produtos.");
        const prev = await replay(tx, actor.propertyId, request.body.key, {
          id: request.params.id,
          ...request.body,
        });
        if (prev.result) return prev.result;
        sameRevision(revision, request.body.revision);
        const p = await productIn(tx, actor.propertyId, request.params.id);
        if (request.body.archived && p.lots.some((l) => l.balance.gt(0)))
          failure(
            400,
            "Para arquivar, o produto precisa estar sem saldo. O histórico será preservado.",
          );
        await tx.product.update({
          where: { id: p.id },
          data: { archived: request.body.archived },
        });
        await bump(tx, actor.propertyId);
        const result = { ok: true };
        await remember(
          tx,
          actor.propertyId,
          request.body.key,
          prev.hash,
          result,
        );
        return result;
      });
    },
  );
  app.post<{
    Params: Static<typeof params>;
    Body: Static<typeof movementBody>;
  }>(
    "/api/properties/:propertyId/movements",
    { schema: { params, body: movementBody } },
    async (request, reply) => {
      const actor = await stockActor(request, request.params.propertyId, true);
      const result = await locked(actor, async (tx, revision) => {
        const prev = await replay(
          tx,
          actor.propertyId,
          request.body.key,
          request.body,
        );
        if (prev.result) return prev.result;
        sameRevision(revision, request.body.revision);
        const movement = await applyMovement(
          tx,
          actor,
          request.body,
          request.body.key,
        );
        await bump(tx, actor.propertyId);
        const result = { id: movement.id };
        await remember(
          tx,
          actor.propertyId,
          request.body.key,
          prev.hash,
          result,
        );
        return result;
      });
      return reply.code(201).send(result);
    },
  );
  const reverseBody = Type.Object(
    { ...envelope, notes: Type.String({ minLength: 3, maxLength: 500 }) },
    { additionalProperties: false },
  );
  app.post<{
    Params: Static<typeof itemParams>;
    Body: Static<typeof reverseBody>;
  }>(
    "/api/properties/:propertyId/movements/:id/reverse",
    { schema: { params: itemParams, body: reverseBody } },
    async (request) => {
      const actor = await stockActor(request, request.params.propertyId, true);
      return locked(actor, async (tx, revision) => {
        const prev = await replay(tx, actor.propertyId, request.body.key, {
          id: request.params.id,
          ...request.body,
        });
        if (prev.result) return prev.result;
        sameRevision(revision, request.body.revision);
        const movement = await reverseMovement(
          tx,
          actor,
          request.params.id,
          request.body.notes,
          request.body.key,
        );
        await bump(tx, actor.propertyId);
        const result = { id: movement.id };
        await remember(
          tx,
          actor.propertyId,
          request.body.key,
          prev.hash,
          result,
        );
        return result;
      });
    },
  );
  const query = Type.Object(
    {
      productId: Type.Optional(id),
      kind: Type.Optional(text(20)),
      from: Type.Optional(text(10)),
      to: Type.Optional(text(10)),
      page: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })),
    },
    { additionalProperties: false },
  );
  app.get<{ Params: Static<typeof params>; Querystring: Static<typeof query> }>(
    "/api/properties/:propertyId/movements",
    { schema: { params, querystring: query } },
    async (request) => {
      const actor = await stockActor(request, request.params.propertyId),
        q = request.query;
      const { occurrence } = await import("./stock-service");
      const from = q.from ? occurrence(q.from, actor.timezone) : undefined,
        to = q.to
          ? new Date(occurrence(q.to, actor.timezone).getTime() + 86400000)
          : undefined;
      const allowed = [
        "OPENING",
        "IN",
        "CONSUMPTION",
        "DISPOSAL",
        "ADJUST_IN",
        "ADJUST_OUT",
        "REVERSAL",
      ];
      if (q.kind && !allowed.includes(q.kind))
        failure(400, "Tipo de movimento inválido.");
      const where = {
        product: { propertyId: actor.propertyId },
        ...(q.productId ? { productId: q.productId } : {}),
        ...(q.kind ? { kind: q.kind as "IN" } : {}),
        ...(from || to ? { occurredAt: { gte: from, lt: to } } : {}),
      };
      const [rows, total] = await Promise.all([
        db.stockMovement.findMany({
          where,
          include: {
            product: { select: { name: true, unit: true } },
            lot: { select: { code: true } },
          },
          orderBy: [
            { occurredAt: "desc" },
            { sequence: "desc" },
          ],
          take: 50,
          skip: ((q.page || 1) - 1) * 50,
        }),
        db.stockMovement.count({ where }),
      ]);
      const reversed = await db.stockMovement.findMany({
        where: {
          reversalOf: { in: rows.map((r) => r.id) },
          product: { propertyId: actor.propertyId },
        },
        select: { reversalOf: true },
      });
      return {
        total,
        page: q.page || 1,
        rows: rows.map((m) => ({
          id: m.id,
          productId: m.productId,
          productName: m.product.name,
          unit: m.product.unit,
          lotCode: m.lot.code,
          kind: m.kind,
          delta: m.delta.toString(),
          unitCost: m.unitCost?.toString() ?? null,
          occurredAt: m.occurredAt.toISOString(),
          recordedAt: m.recordedAt.toISOString(),
          actorName: m.actorName,
          originalResponsible: m.originalResponsible,
          originalReference: m.originalReference,
          originalLine: m.originalLine,
          consumptionConfirmed: m.consumptionConfirmed,
          destination: m.destination,
          notes: m.notes,
          source: m.source,
          reversalOf: m.reversalOf,
          reversed: reversed.some((r) => r.reversalOf === m.id),
        })),
      };
    },
  );
  await registerImportRoutes(app);
}

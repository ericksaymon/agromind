import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { Prisma } from "./generated/prisma/client";
import { db } from "./db";
import { digest, failure, randomToken } from "./security";
import {
  applyMovement,
  bump,
  checkTimeline,
  createProduct,
  decimal,
  keyOf,
  locked,
  occurrence,
  productView,
  sameRevision,
  stockActor,
  validDay,
  type Actor,
  checkUnitQuantity,
} from "./stock-service";
import {
  fields,
  guessMapping,
  importDate,
  importNumber,
  readSheets,
} from "./import-parser";
import { aiAvailable, suggestMapping } from "./import-ai";
import {
  importFields,
  type ImportField,
  type ImportSheet,
  type ImportRow,
  type ImportView,
  type MovementInput,
} from "../../../packages/contracts/src/index";
const id = Type.String({ format: "uuid" }),
  params = Type.Object({ propertyId: id }),
  batchParams = Type.Object({ propertyId: id, id });
const upload = Type.Object(
  {
    fileName: Type.String({ minLength: 1, maxLength: 180 }),
    content: Type.String({ minLength: 1, maxLength: 1400000 }),
    mode: Type.Union([Type.Literal("POSITION"), Type.Literal("HISTORY")]),
  },
  { additionalProperties: false },
);
const mappingSchema = Type.Object(
  Object.fromEntries(
    fields.map((f) => [
      f,
      Type.Optional(Type.Integer({ minimum: 0, maximum: 31 })),
    ]),
  ),
  { additionalProperties: false },
);
const valuesSchema = Type.Object(
  Object.fromEntries(
    fields.map((f) => [f, Type.Optional(Type.String({ maxLength: 500 }))]),
  ),
  { additionalProperties: false },
);
const previewBody = Type.Object(
  {
    sheet: Type.Integer({ minimum: 0, maximum: 9 }),
    mapping: mappingSchema,
    locale: Type.Union([Type.Literal("BR"), Type.Literal("DOT")]),
    positionDate: Type.String({ maxLength: 10 }),
    edits: Type.Array(
      Type.Object(
        {
          line: Type.Integer({ minimum: 2, maximum: 1001 }),
          values: valuesSchema,
          productId: Type.Optional(Type.Union([id, Type.Null()])),
        },
        { additionalProperties: false },
      ),
      { maxItems: 1000 },
    ),
  },
  { additionalProperties: false },
);
type PreviewInput = Static<typeof previewBody>;
type StoredPreview = {
  rows: ImportRow[];
  mapping: Partial<Record<ImportField, number>>;
  token: string;
  revision: number;
  sheet: number;
};
function modeKind(value: string) {
  const aliases: Record<string, MovementInput["kind"]> = {
    abertura: "OPENING",
    opening: "OPENING",
    entrada: "IN",
    in: "IN",
    saida: "CONSUMPTION",
    consumo: "CONSUMPTION",
    consumption: "CONSUMPTION",
    descarte: "DISPOSAL",
    perda: "DISPOSAL",
    disposal: "DISPOSAL",
  };
  const kind = aliases[keyOf(value)];
  if (!kind)
    throw new Error(
      "Tipo inválido. Use abertura, entrada, consumo ou descarte. Ajustes são revisados pelo administrador no painel.",
    );
  return kind;
}
async function getBatch(actor: Actor, id: string) {
  const batch = await db.importBatch.findFirst({
    where: { id, propertyId: actor.propertyId, userId: actor.userId },
  });
  if (!batch) failure(404, "Importação não encontrada.");
  if (batch.status === "DRAFT" && batch.expiresAt <= new Date())
    failure(410, "Este rascunho expirou. Envie a planilha novamente.");
  return batch;
}
async function asView(
  batch: Awaited<ReturnType<typeof getBatch>>,
): Promise<ImportView> {
  const sheets = (Array.isArray(batch.raw) ? batch.raw : []) as unknown as ImportSheet[],
    preview = batch.preview as unknown as StoredPreview | null;
  const repeated = await db.importBatch.count({
    where: {
      propertyId: batch.propertyId,
      fileHash: batch.fileHash,
      status: "CONFIRMED",
      id: { not: batch.id },
    },
  });
  return {
    id: batch.id,
    status: batch.status,
    fileName: batch.fileName,
    mode: batch.mode as ImportView["mode"],
    sheets,
    mapping: preview?.mapping || (sheets[0] ? guessMapping(sheets[0].headers) : {}),
    rows: preview?.rows || [],
    revision: preview?.revision ?? batch.revision,
    previewToken: preview?.token,
    fileRepeated: repeated > 0,
    aiAvailable: aiAvailable(),
    analysisNote: batch.analysisNote,
    model: batch.model,
    result: batch.result as unknown as ImportView["result"],
  };
}
async function makePreview(
  actor: Actor,
  batch: Awaited<ReturnType<typeof getBatch>>,
  input: PreviewInput,
): Promise<StoredPreview> {
  const sheets = batch.raw as unknown as ImportSheet[],
    sheet = sheets[input.sheet];
  if (!sheet) failure(400, "Aba não encontrada.");
  const mapping = input.mapping as Partial<Record<ImportField, number>>;
  const mapped = Object.values(mapping);
  if (
    new Set(mapped).size !== mapped.length ||
    mapped.some((i) => i === undefined || i >= sheet.headers.length)
  )
    failure(400, "Uma coluna só pode ser associada a um campo.");
  if (
    mapping.product === undefined ||
    mapping.quantity === undefined ||
    mapping.unit === undefined
  )
    failure(400, "Associe as colunas de produto, quantidade e unidade.");
  if (
    batch.mode === "HISTORY" &&
    (mapping.kind === undefined || mapping.date === undefined)
  )
    failure(400, "Histórico exige colunas de tipo e data.");
  if (batch.mode === "POSITION" && !validDay(input.positionDate))
    failure(400, "Informe a data da posição de estoque.");
  const snapshot = await db.$transaction(
    async (tx) => ({
      property: await tx.property.findUniqueOrThrow({
        where: { id: actor.propertyId },
      }),
      categories: await tx.category.findMany({ where: { propertyId: actor.propertyId, archived: false } }),
      products: await tx.product.findMany({
        where: { propertyId: actor.propertyId },
        include: { lots: true, movements: { select: { id: true }, take: 1 } },
      }),
    }),
    { isolationLevel: "RepeatableRead" },
  );
  const rows: ImportRow[] = sheet.rows.map((original, i) => {
    const line = i + 2,
      edit = input.edits.find((e) => e.line === line),
      values = Object.fromEntries(
        fields.map((f) => [
          f,
          mapping[f] !== undefined ? original[mapping[f]!] || "" : "",
        ]),
      ) as Record<ImportField, string>;
    for (const f of fields)
      if (edit?.values[f] !== undefined) values[f] = edit.values[f]!.trim();
    const errors: string[] = [],
      warnings: string[] = [];
    let target =
      edit?.productId === null
        ? undefined
        : edit?.productId
          ? snapshot.products.find((p) => p.id === edit.productId)
          : snapshot.products.find((p) => p.nameKey === keyOf(values.product));
    if (edit?.productId && !target)
      errors.push("Produto associado não encontrado nesta propriedade.");
    try {
      values.product = values.product.trim();
      values.category = values.category.trim() || target?.category || "Outros";
      if (!snapshot.categories.some(c => c.nameKey === keyOf(values.category)) && !(target && keyOf(target.category)===keyOf(values.category))) throw new Error("Categoria não cadastrada ou arquivada. Associe a uma categoria ativa ou peça sua criação ao administrador.");
      if (target && keyOf(target.category)!==keyOf(values.category)) warnings.push(`O produto associado mantém a categoria ${target.category}. A importação não reclassifica produtos existentes.`);
      if (
        values.product.length < 2 ||
        values.product.length > 120 ||
        values.category.length > 80
      )
        throw new Error("Confira nome e categoria.");
      const units: Record<string, string> = {
        l: "L",
        litro: "L",
        litros: "L",
        kg: "kg",
        quilo: "kg",
        quilos: "kg",
        g: "g",
        ml: "mL",
        un: "un",
        unidade: "un",
        unidades: "un",
        m: "m",
      };
      values.unit = units[keyOf(values.unit)] || values.unit;
      if (!["L", "kg", "g", "mL", "un", "m"].includes(values.unit))
        throw new Error(
          "Unidade desconhecida: converta explicitamente para L, kg, g, mL, un ou m.",
        );
      values.quantity = importNumber(values.quantity, input.locale);
      if (Number(values.quantity) <= 0 && batch.mode === "HISTORY")
        throw new Error("A quantidade movimentada precisa ser maior que zero.");
      if (Number(values.quantity) === 0)
        warnings.push(
          "Saldo inicial zero: cadastra o produto sem criar movimentação de abertura.",
        );
      checkUnitQuantity(values.unit, decimal(values.quantity));
      values.minimum = importNumber(values.minimum, input.locale, 3, false);
      checkUnitQuantity(values.unit, decimal(values.minimum || "0"));
      if (!values.minimum) warnings.push("Mínimo não informado: não será tratado como limite confirmado.");
      if (values.responsible.length > 120 || values.reference.length > 180)
        throw new Error("Responsável ou referência de origem excede o limite.");
      const rawKind = mapping.kind !== undefined ? original[mapping.kind] || "" : "";
      if (batch.mode === "HISTORY" && keyOf(rawKind) === "saida" && !["sim", "uso", "consumo"].includes(keyOf(values.usageConfirmed)))
        warnings.push("Saída genérica: saldo será atualizado, mas não contará como consumo até informar 'sim' em uso confirmado.");
      values.unitCost = importNumber(values.unitCost, input.locale, 4, false);
      values.expiry = importDate(values.expiry);
      if (
        values.expiry &&
        !["na", "n a", "nao se aplica"].includes(keyOf(values.expiry)) &&
        !validDay(values.expiry)
      )
        throw new Error(
          "Validade inválida. Use DD/MM/AAAA, AAAA-MM-DD ou N/A.",
        );
      if (["na", "n a", "nao se aplica"].includes(keyOf(values.expiry)))
        values.expiry = "N/A";
      values.date = importDate(
        batch.mode === "POSITION" ? input.positionDate : values.date,
      );
      occurrence(values.date, actor.timezone);
      values.kind =
        batch.mode === "POSITION" ? "OPENING" : modeKind(values.kind);
      values.lot = values.lot.trim() || "SEM-LOTE";
      if (
        values.lot.length > 80 ||
        values.supplier.length > 120 ||
        values.destination.length > 120
      )
        throw new Error(
          "Lote, fornecedor ou destino excede o limite de caracteres.",
        );
      if (values.kind === "CONSUMPTION" && !values.destination.trim())
        throw new Error("Informe o destino do consumo.");
      if (values.kind === "DISPOSAL" && !values.notes.trim())
        throw new Error("Informe o motivo do descarte.");
      if (
        values.kind === "CONSUMPTION" &&
        validDay(values.expiry) &&
        values.expiry < values.date.slice(0, 10)
      )
        throw new Error("Lote vencido na data do consumo.");
      if (target) {
        if (target.archived)
          throw new Error("Produto arquivado. Reative-o antes de importar.");
        if (target.unit !== values.unit)
          throw new Error(
            `Unidade incompatível com ${target.name} (${target.unit}).`,
          );
        if (batch.mode === "POSITION" && target.movements.length)
          throw new Error(
            "Este produto já tem histórico. Não some uma posição de estoque ao saldo existente. Use movimentos ou ajuste conciliado.",
          );
        warnings.push(
          `Associado a ${target.name}. Categoria e mínimo cadastrados serão preservados.`,
        );
        const lot = target.lots.find((l) => l.code === values.lot);
        if (lot) {
          if (
            values.unitCost &&
            (lot.unitCost === null || !lot.unitCost.eq(values.unitCost))
          )
            throw new Error(
              "Custo diferente do lote existente. Use um novo lote.",
            );
          if (values.supplier && values.supplier !== lot.supplier)
            throw new Error(
              "Fornecedor difere do lote existente. Confira o lote.",
            );
          if (
            values.expiry &&
            values.expiry !==
              (lot.expiresOn?.toISOString().slice(0, 10) ||
                (lot.expiryStatus === "NA" ? "N/A" : ""))
          )
            throw new Error(
              "Validade difere do lote existente. Confira o lote.",
            );
        }
      } else {
        const similar = snapshot.products.filter((p) =>
          values.product
            .split(/\s+/)
            .some(
              (w) => w.length > 2 && p.nameKey.split(" ").includes(keyOf(w)),
            ),
        );
        if (similar.length)
          warnings.push(
            `Nome semelhante: ${similar
              .slice(0, 3)
              .map((p) => p.name)
              .join(
                ", ",
              )}. Associe ao produto existente se for o mesmo insumo.`,
          );
        if (["CONSUMPTION", "DISPOSAL"].includes(values.kind))
          warnings.push(
            "O produto/lote precisa ter abertura ou entrada anterior entre as linhas selecionadas.",
          );
      }
      if (!values.unitCost)
        warnings.push(
          "Custo não informado: o valor financeiro poderá ficar parcial.",
        );
      if (!values.expiry)
        warnings.push("Validade não informada; não será presumida.");
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "Dados inválidos.");
    }
    const fingerprint = digest(
      JSON.stringify(
        values.reference
          ? {
              product: keyOf(target?.name || values.product),
              reference: values.reference,
            }
          : {
              product: keyOf(target?.name || values.product),
              unit: values.unit,
              quantity: values.quantity,
              kind: values.kind,
              date: values.date,
              lot: values.lot,
              cost: values.unitCost,
              destination: values.destination,
            },
      ),
    );
    return {
      line,
      original,
      values,
      productId: target?.id || null,
      fingerprint,
      errors,
      warnings,
      duplicate: false,
    };
  });
  const fingerprints = await db.stockMovement.findMany({
    where: {
      product: { propertyId: actor.propertyId },
      fingerprint: { in: rows.map((r) => r.fingerprint) },
    },
    select: { fingerprint: true },
  });
  const seen = new Set(fingerprints.map((m) => m.fingerprint));
  for (const row of rows) {
    if (seen.has(row.fingerprint)) {
      row.duplicate = true;
      row.warnings.push(
        "Possível movimento duplicado. Não selecionado por padrão.",
      );
    }
    seen.add(row.fingerprint);
  }
  return {
    rows,
    mapping,
    token: randomToken(),
    revision: snapshot.property.inventoryRevision,
    sheet: input.sheet,
  };
}
export async function registerImportRoutes(app: FastifyInstance) {
  app.post<{ Params: Static<typeof params>; Body: Static<typeof upload> }>(
    "/api/properties/:propertyId/imports",
    {
      bodyLimit: 1500000,
      schema: { params, body: upload },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const actor = await stockActor(request, request.params.propertyId, true),
        sheets = await readSheets(request.body.fileName, request.body.content);
      const batch = await locked(actor, async (tx, revision) => {
      await tx.importBatch.deleteMany({
        where: {
          propertyId: actor.propertyId,
          userId: actor.userId,
          status: "DRAFT",
          expiresAt: { lt: new Date() },
        },
      });
      if (
        (await tx.importBatch.count({
          where: {
            propertyId: actor.propertyId,
            userId: actor.userId,
            status: "DRAFT",
          },
        })) >= 10
      )
        failure(
          400,
          "Você já tem dez rascunhos. Cancele um deles antes de enviar outro arquivo.",
        );
      return tx.importBatch.create({
        data: {
          propertyId: actor.propertyId,
          userId: actor.userId,
          fileName: request.body.fileName,
          fileHash: digest(request.body.content),
          mode: request.body.mode,
          revision,
          raw: sheets as unknown as Prisma.InputJsonValue,
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      });
      return reply.code(201).send(await asView(batch));
    },
  );
  app.get<{ Params: Static<typeof params> }>(
    "/api/properties/:propertyId/imports",
    { schema: { params } },
    async (request) => {
      const actor = await stockActor(request, request.params.propertyId);
      return {
        batches: await db.importBatch.findMany({
          where: {
            propertyId: actor.propertyId,
            OR: [
              { status: "CONFIRMED" },
              {
                userId: actor.userId,
                status: "DRAFT",
                expiresAt: { gt: new Date() },
              },
            ],
          },
          select: {
            id: true,
            fileName: true,
            mode: true,
            status: true,
            createdAt: true,
            result: true,
          },
          orderBy: { createdAt: "desc" },
          take: 30,
        }),
        aiAvailable: aiAvailable(),
      };
    },
  );
  app.get<{ Params: Static<typeof batchParams> }>(
    "/api/properties/:propertyId/imports/:id",
    { schema: { params: batchParams } },
    async (request) =>
      asView(
        await getBatch(
          await stockActor(request, request.params.propertyId),
          request.params.id,
        ),
      ),
  );
  app.post<{ Params: Static<typeof batchParams>; Body: PreviewInput }>(
    "/api/properties/:propertyId/imports/:id/preview",
    { bodyLimit: 1200000, schema: { params: batchParams, body: previewBody } },
    async (request) => {
      const actor = await stockActor(request, request.params.propertyId, true),
        batch = await getBatch(actor, request.params.id);
      if (batch.status !== "DRAFT")
        failure(409, "Esta importação já foi encerrada.");
      const preview = await makePreview(actor, batch, request.body);
      const updated = await locked(actor, async (tx, revision) => {
        sameRevision(revision, preview.revision);
        return tx.importBatch.updateMany({
        where: { id: batch.id, status: "DRAFT" },
        data: {
          preview: preview as unknown as Prisma.InputJsonValue,
          revision: preview.revision,
        },
      });
      });
      if (!updated.count) failure(409, "Esta importação já foi encerrada.");
      return asView(await getBatch(actor, batch.id));
    },
  );
  const aiBody = Type.Object(
    {
      sheet: Type.Integer({ minimum: 0, maximum: 9 }),
      consent: Type.Literal(true),
    },
    { additionalProperties: false },
  );
  app.post<{ Params: Static<typeof batchParams>; Body: Static<typeof aiBody> }>(
    "/api/properties/:propertyId/imports/:id/analyze",
    {
      schema: { params: batchParams, body: aiBody },
      config: { rateLimit: { max: 3, timeWindow: "5 minutes" } },
    },
    async (request) => {
      const actor = await stockActor(request, request.params.propertyId, true),
        batch = await getBatch(actor, request.params.id);
      if (batch.status !== "DRAFT")
        failure(409, "Esta importação já foi encerrada.");
      const sheet = (batch.raw as unknown as ImportSheet[])[request.body.sheet];
      if (!sheet) failure(400, "Aba não encontrada.");
      let suggestion: Awaited<ReturnType<typeof suggestMapping>>;
      try {
        suggestion = await suggestMapping(sheet.headers);
      } catch (e) {
        if ((e as { statusCode?: number }).statusCode) throw e;
        failure(
          503,
          "A análise demorou ou falhou. Continue pelo mapeamento manual.",
          "AI_UNAVAILABLE",
        );
      }
      await locked(actor, async tx => {
        const updated = await tx.importBatch.updateMany({
        where: { id: batch.id, userId: actor.userId, status: "DRAFT", expiresAt: { gt: new Date() } },
        data: {
          model: suggestion.model,
          analysisNote:
            suggestion.note ||
            "Mapeamento sugerido pela IA; revisão humana obrigatória.",
        },
      });
        if (!updated.count) failure(409, "O rascunho não está mais disponível.");
      });
      return suggestion;
    },
  );
  const confirm = Type.Object(
    {
      previewToken: Type.String({ minLength: 64, maxLength: 64 }),
      lines: Type.Array(Type.Integer({ minimum: 2, maximum: 1001 }), {
        minItems: 1,
        maxItems: 1000,
      }),
      acknowledgeWarnings: Type.Literal(true),
      allowDuplicates: Type.Boolean(),
    },
    { additionalProperties: false },
  );
  app.post<{
    Params: Static<typeof batchParams>;
    Body: Static<typeof confirm>;
  }>(
    "/api/properties/:propertyId/imports/:id/confirm",
    { schema: { params: batchParams, body: confirm } },
    async (request) => {
      const actor = await stockActor(request, request.params.propertyId, true);
      return locked(actor, async (tx, revision) => {
        const batch = await tx.importBatch.findFirst({
          where: {
            id: request.params.id,
            propertyId: actor.propertyId,
            userId: actor.userId,
          },
        });
        if (!batch) failure(404, "Importação não encontrada.");
        if (batch.status === "CONFIRMED")
          return { id: batch.id, result: batch.result };
        if (batch.status !== "DRAFT" || batch.expiresAt <= new Date())
          failure(410, "Rascunho cancelado ou expirado.");
        const preview = batch.preview as unknown as StoredPreview | null;
        if (!preview || preview.token !== request.body.previewToken)
          failure(409, "Gere uma nova prévia antes de confirmar.");
        sameRevision(revision, preview.revision);
        const lines = new Set(request.body.lines);
        if (lines.size !== request.body.lines.length)
          failure(400, "Seleção de linhas repetida.");
        const selected = preview.rows.filter((r) => lines.has(r.line));
        if (
          selected.length !== lines.size ||
          selected.some((r) => r.errors.length)
        )
          failure(
            400,
            "A seleção contém linhas inválidas. Corrija ou desmarque essas linhas.",
          );
        if (selected.some((r) => r.duplicate) && !request.body.allowDuplicates)
          failure(
            409,
            "Existem possíveis duplicidades. Revise e confirme explicitamente a repetição.",
          );
        const movementIds: string[] = [];
        const touchedLots = new Set<string>();
        const products = new Map<string, string>();
        for (const row of selected
          .slice()
          .sort(
            (a, b) =>
              occurrence(a.values.date, actor.timezone).getTime() -
                occurrence(b.values.date, actor.timezone).getTime() ||
              (a.values.kind === "OPENING" ? -1 : 1) -
                (b.values.kind === "OPENING" ? -1 : 1) ||
              a.line - b.line,
          )) {
          const v = row.values;
          let productId = row.productId || products.get(keyOf(v.product));
          if (!productId) {
            const existing = await tx.product.findUnique({
              where: {
                propertyId_nameKey: {
                  propertyId: actor.propertyId,
                  nameKey: keyOf(v.product),
                },
              },
            });
            if (existing) productId = existing.id;
            else
              productId = (
                await createProduct(tx, actor, {
                  name: v.product,
                  category: v.category,
                  unit: v.unit,
                  minimum: v.minimum || "0",
                  minimumKnown: !!v.minimum,
                  acknowledgeSimilar: true,
                })
              ).id;
            products.set(keyOf(v.product), productId);
          }
          const p = await tx.product.findUniqueOrThrow({
            where: { id: productId },
          });
          if (p.propertyId !== actor.propertyId || p.unit !== v.unit)
            failure(400, `Registro ${row.line}: unidade incompatível.`);
          if (batch.mode === "POSITION") await tx.product.update({ where: { id: productId }, data: { positionOn: new Date(v.date) } });
          const existingLot = await tx.stockLot.findUnique({
            where: { productId_code: { productId, code: v.lot } },
          });
          if (batch.mode === "POSITION" && Number(v.quantity) === 0) {
            if (!existingLot)
              await tx.stockLot.create({
                data: {
                  productId,
                  code: v.lot,
                  expiryStatus:
                    v.expiry === "N/A" ? "NA" : v.expiry ? "DATED" : "UNKNOWN",
                  expiresOn:
                    v.expiry && v.expiry !== "N/A" ? new Date(v.expiry) : null,
                  unitCost: v.unitCost || null,
                  supplier: v.supplier || null,
                },
              });
            continue;
          }
          const input: MovementInput = {
            productId,
            lotId: existingLot?.id,
            kind: v.kind as MovementInput["kind"],
            quantity: v.quantity,
            occurredAt: v.date,
            destination: v.destination,
            notes: v.notes,
            originalResponsible: v.responsible,
            originalReference: v.reference,
            originalLine: row.line,
            consumptionConfirmed: (() => {
              const originalKind = preview.mapping.kind !== undefined ? row.original[preview.mapping.kind] || "" : "";
              return keyOf(originalKind) !== "saida" || ["sim", "uso", "consumo"].includes(keyOf(v.usageConfirmed));
            })(),
            lot: {
              code: v.lot,
              expiryStatus:
                v.expiry === "N/A" ? "NA" : v.expiry ? "DATED" : "UNKNOWN",
              expiresOn: v.expiry === "N/A" ? undefined : v.expiry,
              unitCost: v.unitCost,
              supplier: v.supplier,
            },
          };
          try {
            const m = await applyMovement(
              tx,
              actor,
              input,
              `import:${batch.id}:${row.line}`,
              "IMPORT",
              batch.id,
              row.fingerprint,
              false,
            );
            movementIds.push(m.id);
            touchedLots.add(m.lotId);
          } catch (e) {
            const err = e as { statusCode?: number; message?: string };
            if (err.statusCode)
              failure(err.statusCode, `Registro ${row.line}: ${err.message}`);
            throw e;
          }
        }
        for (const lotId of touchedLots) await checkTimeline(tx, lotId);
        const result = {
          imported: selected.length,
          ignored: preview.rows.length - selected.length,
          movementIds,
        };
        await tx.importBatch.update({
          where: { id: batch.id },
          data: { status: "CONFIRMED", confirmedAt: new Date(), result },
        });
        await bump(tx, actor.propertyId);
        return { id: batch.id, result };
      });
    },
  );
  app.post<{ Params: Static<typeof batchParams> }>(
    "/api/properties/:propertyId/imports/:id/cancel",
    { schema: { params: batchParams } },
    async (request) => {
      const actor = await stockActor(request, request.params.propertyId, true);
      await getBatch(actor, request.params.id);
      await locked(actor, async (tx) => {
        const updated = await tx.importBatch.updateMany({
          where: {
            id: request.params.id,
            status: "DRAFT",
            userId: actor.userId,
            propertyId: actor.propertyId,
          },
          data: { status: "CANCELLED", raw: [], preview: Prisma.DbNull },
        });
        if (!updated.count) failure(409, "Esta importação já foi encerrada.");
      });
      return { ok: true };
    },
  );
}

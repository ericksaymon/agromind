import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { db } from "./db";
import { bump, locked, stockActor, validDay, dayInZone, sameRevision } from "./stock-service";
import { failure } from "./security";
import { processAnalysis, analysisView } from "./analysis-service";
import { shiftDay } from "./analysis-engine";
import { propertyPolicy } from "./analysis-policy";
import { Prisma } from "./generated/prisma/client";
const id = Type.String({ format: "uuid" });
const params = Type.Object({ propertyId: id });
const item = Type.Object({ propertyId: id, id });
const reason = Type.String({ minLength: 3, maxLength: 500, pattern: "\\S.*\\S" });
export async function registerAnalysisRoutes(app: FastifyInstance) {
  app.get<{ Params: Static<typeof params> }>("/api/properties/:propertyId/analysis", { schema: { params } }, async req => {
    await stockActor(req, req.params.propertyId);
    const before = await analysisView(req.params.propertyId);
    if ((before.status === "PENDING" || before.status === "STALE") && !before.error) await processAnalysis(req.params.propertyId).catch(e => app.log.error(e, "Análise adiada para retomada automática."));
    return analysisView(req.params.propertyId);
  });
  app.post<{ Params: Static<typeof params> }>("/api/properties/:propertyId/analysis/retry", { schema: { params, body: Type.Object({}, { additionalProperties: false }) } }, async req => {
    const actor = await stockActor(req, req.params.propertyId, true);
    await processAnalysis(actor.propertyId).catch(e => app.log.error(e, "Análise não concluída."));
    return analysisView(actor.propertyId);
  });
  // Um array de tipos preserva null: anyOf com coerção AJV poderia convertê-lo em 0.
  const nullableDay = Type.Unsafe<string | null>({ type: ["string", "null"], maxLength: 10 });
  const productBody = Type.Object({ revision: Type.Integer({ minimum: 0 }), start: nullableDay, end: nullableDay, ongoing: Type.Boolean(), leadTimeDays: Type.Unsafe<number | null>({ type: ["integer", "null"], minimum: 0, maximum: 730 }), safetyDays: Type.Integer({ minimum: 0, maximum: 365 }), reason }, { additionalProperties: false });
  app.post<{ Params: Static<typeof item>; Body: Static<typeof productBody> }>("/api/properties/:propertyId/products/:id/analysis-settings", { schema: { params: item, body: productBody } }, async req => {
    const actor = await stockActor(req, req.params.propertyId, true), b = req.body;
    if ((b.start && !validDay(b.start)) || (b.end && !validDay(b.end)) || (!!b.start !== !!b.end) || (b.start && b.end && (b.start > b.end || b.end > dayInZone(new Date(), actor.timezone))) || (b.ongoing && !b.start)) failure(400, "Informe um intervalo de cobertura válido, sem datas futuras.");
    if (b.ongoing && b.end! < shiftDay(dayInZone(new Date(), actor.timezone), -1)) failure(400, "Para acompanhamento contínuo, confirme o histórico até ontem; não deixe lacunas.");
    return locked(actor, async (tx, revision) => {
      sameRevision(revision, b.revision);
      const p = await tx.product.findFirst({ where: { id: req.params.id, propertyId: actor.propertyId } });
      if (!p) failure(404, "Produto não encontrado.");
      if (actor.role !== "ADMIN" && (b.leadTimeDays !== p.leadTimeDays || b.safetyDays !== p.safetyDays)) failure(403, "Somente administradores podem alterar prazos da política.");
      const data = { coverageStart: b.start ? new Date(b.start) : null, coverageEnd: b.end ? new Date(b.end) : null, coverageOngoing: b.ongoing, coverageConfirmedBy: actor.userId, leadTimeDays: b.leadTimeDays, safetyDays: b.safetyDays };
      await tx.product.update({ where: { id: p.id }, data });
      await tx.analysisEvent.create({ data: { propertyId: actor.propertyId, productId: p.id, kind: "COVERAGE_CHANGED", actorId: actor.userId, actorName: actor.name, details: { before: { start: p.coverageStart?.toISOString() ?? null, end: p.coverageEnd?.toISOString() ?? null, ongoing: p.coverageOngoing, leadTimeDays: p.leadTimeDays, safetyDays: p.safetyDays }, after: b } } });
      await bump(tx, actor.propertyId); return { ok: true };
    });
  });
  const intelligenceSchema = Type.Object({
    comparisonDays: Type.Integer({ minimum: 7, maximum: 90 }),
    consumptionChangePercent: Type.Integer({ minimum: 10, maximum: 500 }),
    trendPercent: Type.Integer({ minimum: 5, maximum: 200 }),
    withdrawalMultiplier: Type.Integer({ minimum: 2, maximum: 10 }),
    withdrawalMinSamples: Type.Integer({ minimum: 5, maximum: 50 }),
    excessDays: Type.Integer({ minimum: 7, maximum: 730 }),
    priceChangePercent: Type.Integer({ minimum: 5, maximum: 500 }),
    highValuePercent: Type.Integer({ minimum: 1, maximum: 100 }),
    minimumChangeQuantity: Type.String({ pattern: "^(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,3})?$", maxLength: 13 }),
  }, { additionalProperties: false });
  const policyBody = Type.Object({ policyVersion: Type.Integer({ minimum: 1 }), reorderDays: Type.Integer({ minimum: 1, maximum: 730 }), expiryWarningDays: Type.Integer({ minimum: 1, maximum: 365 }), inactivityDays: Type.Integer({ minimum: 7, maximum: 730 }), intelligence: Type.Optional(intelligenceSchema), reason }, { additionalProperties: false });
  app.post<{ Params: Static<typeof item>; Body: { reason: string } }>("/api/properties/:propertyId/movements/:id/classify", { schema: { params: item, body: Type.Object({ reason }, { additionalProperties: false }) } }, async req => {
    const actor = await stockActor(req, req.params.propertyId, true);
    return locked(actor, async tx => {
      const m = await tx.stockMovement.findFirst({ where: { id: req.params.id, product: { propertyId: actor.propertyId }, kind: "CONSUMPTION" } });
      if (!m) failure(404, "Saída não encontrada.");
      if (await tx.stockMovement.findFirst({ where: { reversalOf: m.id } })) failure(409, "Movimento estornado não pode ser classificado.");
      if (m.consumptionConfirmed) return { ok: true };
      await tx.stockMovement.update({ where: { id: m.id }, data: { consumptionConfirmed: true } });
      await tx.analysisEvent.create({ data: { propertyId: actor.propertyId, productId: m.productId, kind: "NATURE_CONFIRMED", actorId: actor.userId, actorName: actor.name, details: { movementId: m.id, before: false, after: true, reason: req.body.reason } } });
      await bump(tx, actor.propertyId); return { ok: true };
    });
  });
  app.post<{ Params: Static<typeof params>; Body: Static<typeof policyBody> }>("/api/properties/:propertyId/analysis/policy", { schema: { params, body: policyBody } }, async req => {
    const actor = await stockActor(req, req.params.propertyId, true);
    return locked(actor, async tx => {
      if (actor.role !== "ADMIN") failure(403, "Somente administradores podem alterar políticas.");
      const p = await tx.property.findUniqueOrThrow({ where: { id: actor.propertyId } });
      if (p.policyVersion !== req.body.policyVersion) failure(409, "A política mudou. Atualize antes de salvar.");
      const { reason: note, policyVersion: _, intelligence, ...data } = req.body;
      await tx.property.update({ where: { id: p.id }, data: { ...data, ...(intelligence ? { intelligencePolicy: intelligence as unknown as Prisma.InputJsonValue } : {}), policyVersion: { increment: 1 }, analysisPending: true } });
      await tx.analysisEvent.create({ data: { propertyId: p.id, kind: "POLICY_CHANGED", actorId: actor.userId, actorName: actor.name, details: { before: propertyPolicy(p) as unknown as Prisma.InputJsonValue, after: { ...data, intelligence: intelligence ?? propertyPolicy(p).intelligence! }, reason: note } as unknown as Prisma.InputJsonValue } });
      return { ok: true };
    });
  });
  const actionBody = Type.Object({ version: Type.Integer({ minimum: 0 }), state: Type.Union([Type.Literal("PENDING"), Type.Literal("REVIEWING"), Type.Literal("RESOLVED"), Type.Literal("DISMISSED")]), assigneeId: Type.Union([id, Type.Null()]), reason }, { additionalProperties: false });
  app.get<{ Params: Static<typeof params> }>("/api/properties/:propertyId/analysis/policy/history", { schema: { params } }, async req => {
    await stockActor(req, req.params.propertyId);
    return { events: await db.analysisEvent.findMany({ where: { propertyId: req.params.propertyId, kind: "POLICY_CHANGED" }, orderBy: { createdAt: "desc" }, take: 30 }) };
  });
  app.post<{ Params: Static<typeof item>; Body: Static<typeof actionBody> }>("/api/properties/:propertyId/alerts/:id/action", { schema: { params: item, body: actionBody } }, async req => {
    const actor = await stockActor(req, req.params.propertyId, true), b = req.body;
    return locked(actor, async tx => {
      const alert = await tx.alertOccurrence.findFirst({ where: { id: req.params.id, propertyId: actor.propertyId } });
      if (!alert) failure(404, "Alerta não encontrado.");
      if (alert.actionVersion !== b.version) failure(409, "O acompanhamento mudou. Atualize antes de salvar.");
      const assignee = b.assigneeId ? await tx.membership.findUnique({ where: { userId_propertyId: { userId: b.assigneeId, propertyId: actor.propertyId } }, include: { user: true } }) : null;
      if (b.assigneeId && (!assignee || assignee.role === "VIEWER")) failure(400, "Responsável precisa ser administrador ou operador da propriedade.");
      await tx.alertOccurrence.update({ where: { id: alert.id }, data: { actionState: b.state, actionVersion: { increment: 1 }, assigneeId: b.assigneeId, assigneeName: assignee?.user.name ?? null } });
      await tx.analysisEvent.create({ data: { propertyId: actor.propertyId, alertId: alert.id, kind: "ACTION_CHANGED", actorId: actor.userId, actorName: actor.name, details: { before: { state: alert.actionState, assigneeId: alert.assigneeId }, after: { state: b.state, assigneeId: b.assigneeId }, reason: b.reason } } });
      return { ok: true };
    });
  });
  app.get<{ Params: Static<typeof params> }>("/api/properties/:propertyId/analysis/team", { schema: { params } }, async req => {
    await stockActor(req, req.params.propertyId);
    const team = await db.membership.findMany({ where: { propertyId: req.params.propertyId, role: { not: "VIEWER" } }, include: { user: { select: { id: true, name: true } } } });
    return team.map(t => t.user);
  });
  app.get<{ Params: Static<typeof item> }>("/api/properties/:propertyId/alerts/:id/history", { schema: { params: item } }, async req => {
    await stockActor(req, req.params.propertyId);
    const alert = await db.alertOccurrence.findFirst({ where: { id: req.params.id, propertyId: req.params.propertyId } });
    if (!alert) failure(404, "Alerta não encontrado.");
    const history = await db.analysisEvent.findMany({ where: { propertyId: req.params.propertyId, alertId: alert.id }, orderBy: { createdAt: "asc" } });
    return { history };
  });
  app.get<{ Params: Static<typeof item> }>("/api/properties/:propertyId/products/:id/analyses", { schema: { params: item } }, async req => {
    await stockActor(req, req.params.propertyId);
    if (!await db.product.findFirst({ where: { id: req.params.id, propertyId: req.params.propertyId } })) failure(404, "Produto não encontrado.");
    const snapshots = await db.analysisSnapshot.findMany({ where: { propertyId: req.params.propertyId }, orderBy: { createdAt: "desc" }, take: 30 });
    return { snapshots: snapshots.map(s => ({ id: s.id, createdAt: s.createdAt.toISOString(), revision: s.revision, referenceDay: s.referenceDay, ruleVersion: s.ruleVersion, policyVersion: s.policyVersion, product: (s.result as unknown as import("../../../packages/contracts/src/index").AnalysisResult).products.find(p => p.id === req.params.id) })).filter(s => s.product),
      events: await db.analysisEvent.findMany({ where: { propertyId: req.params.propertyId, productId: req.params.id }, orderBy: { createdAt: "desc" }, take: 30 }) };
  });
}

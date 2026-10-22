import { db } from "./db";
import { Prisma } from "./generated/prisma/client";
import { calculateAnalysis, dateKey, RULE_VERSION } from "./analysis-engine";
import type { AnalysisView, AnalysisResult, AlertOccurrenceView } from "../../../packages/contracts/src/index";
import { propertyPolicy } from "./analysis-policy";
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function processAnalysis(propertyId: string, now = new Date()) {
  try {
    return await db.$transaction(async tx => {
      // Mesmo bloqueio das mutações de estoque: publica somente a revisão consistente.
      await tx.$queryRaw`SELECT id FROM "Property" WHERE id=${propertyId}::uuid FOR UPDATE`;
      const p = await tx.property.findUnique({ where: { id: propertyId } });
      if (!p) return null;
      const referenceDay = dateKey(now, p.timezone);
      const policy = propertyPolicy(p);
      const key = { propertyId, revision: p.inventoryRevision, policyVersion: p.policyVersion, referenceDay, ruleVersion: RULE_VERSION };
      const existing = await tx.analysisSnapshot.findUnique({ where: { propertyId_revision_policyVersion_referenceDay_ruleVersion: key } });
      if (existing) {
        if (p.analysisPending || p.analysisError) await tx.property.update({ where: { id: propertyId }, data: { analysisPending: false, analysisError: null } });
        return existing;
      }
      const products = await tx.product.findMany({ where: { propertyId }, include: { lots: true, movements: true }, orderBy: { name: "asc" } });
      const result = calculateAnalysis(products, referenceDay, p.timezone, p.inventoryRevision, policy);
      const snapshot = await tx.analysisSnapshot.create({ data: { ...key, timezone: p.timezone, result: json(result) } });
      const active = await tx.alertOccurrence.findMany({ where: { propertyId, closedAt: null } });
      const current = new Set(result.alerts.map(a => a.identity));
      for (const alert of result.alerts) {
        const previous = active.find(a => a.identity === alert.identity);
        if (previous) {
          await tx.alertOccurrence.update({ where: { id: previous.id }, data: { priority: alert.priority, evidence: json(alert), lastSeenAt: now } });
          if (previous.priority !== alert.priority) await tx.analysisEvent.create({ data: { propertyId, alertId: previous.id, kind: "PRIORITY_CHANGED", actorName: "Motor de análise", details: { from: previous.priority, to: alert.priority, snapshotId: snapshot.id } } });
        } else {
          const last = await tx.alertOccurrence.findFirst({ where: { propertyId, identity: alert.identity }, orderBy: { firstSeenAt: "desc" } });
          const created = await tx.alertOccurrence.create({ data: { propertyId, identity: alert.identity, productId: alert.productId, lotId: alert.lotId, rule: alert.rule, priority: alert.priority, evidence: json(alert), previousId: last?.id, firstSeenAt: now, lastSeenAt: now } });
          await tx.analysisEvent.create({ data: { propertyId, alertId: created.id, kind: last ? "RECURRED" : "DETECTED", actorName: "Motor de análise", details: { snapshotId: snapshot.id, previousId: last?.id ?? null } } });
        }
      }
      for (const a of active.filter(a => !current.has(a.identity))) {
        await tx.alertOccurrence.update({ where: { id: a.id }, data: { closedAt: now } });
        await tx.analysisEvent.create({ data: { propertyId, alertId: a.id, kind: "RISK_CLOSED", actorName: "Motor de análise", details: { snapshotId: snapshot.id } } });
      }
      await tx.property.update({ where: { id: propertyId }, data: { analysisPending: false, analysisError: null, analysisAttemptAt: now } });
      return snapshot;
    }, { timeout: 60000, maxWait: 15000 });
  } catch (error) {
    // Conserva o resultado anterior. A revisão pendente permite retomada após falha/reinício.
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Property" WHERE id=${propertyId}::uuid FOR UPDATE`;
      const p = await tx.property.findUnique({ where: { id: propertyId } });
      if (!p) return;
      let referenceDay: string | null = null;
      try { referenceDay = dateKey(now, p.timezone); } catch { /* Mantém a falha de fuso visível, sem alterar estoque. */ }
      const current = referenceDay ? await tx.analysisSnapshot.findUnique({ where: { propertyId_revision_policyVersion_referenceDay_ruleVersion: { propertyId, revision: p.inventoryRevision, policyVersion: p.policyVersion, referenceDay, ruleVersion: RULE_VERSION } } }) : null;
      // Uma tentativa concorrente bem-sucedida não deve ser marcada como falha por esta.
      if (current && !p.analysisPending && !p.analysisError) return;
      await tx.property.update({ where: { id: propertyId }, data: { analysisPending: true, analysisError: "Não foi possível atualizar a análise. O processamento será retomado automaticamente.", analysisAttemptAt: now } });
    });
    throw error;
  }
}

export async function analysisView(propertyId: string): Promise<AnalysisView> {
  return db.$transaction(async tx => {
    const p = await tx.property.findUniqueOrThrow({ where: { id: propertyId } });
    const snapshot = await tx.analysisSnapshot.findFirst({ where: { propertyId }, orderBy: { createdAt: "desc" } });
    const alerts = await tx.alertOccurrence.findMany({ where: { propertyId }, orderBy: { firstSeenAt: "desc" } });
    const current = !!snapshot && snapshot.revision === p.inventoryRevision && snapshot.policyVersion === p.policyVersion && snapshot.ruleVersion === RULE_VERSION && snapshot.referenceDay === dateKey(new Date(), p.timezone) && !p.analysisPending;
    const result = snapshot ? snapshot.result as unknown as AnalysisResult : null;
    return { status: p.analysisError ? "ERROR" : current ? result!.products.length ? "CURRENT" : "EMPTY" : snapshot ? "STALE" : "PENDING",
      snapshotId: snapshot?.id ?? null, calculatedAt: snapshot?.createdAt.toISOString() ?? null, result, error: p.analysisError,
      policy: propertyPolicy(p), revision: p.inventoryRevision,
      alerts: alerts.map(a => ({ ...a, evidence: a.evidence as unknown as AlertOccurrenceView["evidence"], actionState: a.actionState as AlertOccurrenceView["actionState"], firstSeenAt: a.firstSeenAt.toISOString(), lastSeenAt: a.lastSeenAt.toISOString(), closedAt: a.closedAt?.toISOString() ?? null })) };
  }, { isolationLevel: "RepeatableRead" });
}

export async function analysisTick(now = new Date(), propertyIds?: string[]) {
  const properties = await db.property.findMany({ where: propertyIds ? { id: { in: propertyIds } } : {}, select: { id: true, timezone: true, inventoryRevision: true, policyVersion: true, analysisPending: true, analysisError: true, analysisAttemptAt: true } });
  for (const p of properties) {
    if (p.analysisError && p.analysisAttemptAt && now.getTime() - p.analysisAttemptAt.getTime() < 60000) continue;
    const exists = !p.analysisPending && await db.analysisSnapshot.findUnique({ where: { propertyId_revision_policyVersion_referenceDay_ruleVersion: { propertyId: p.id, revision: p.inventoryRevision, policyVersion: p.policyVersion, referenceDay: dateKey(now, p.timezone), ruleVersion: RULE_VERSION } }, select: { id: true } });
    if (!exists) await processAnalysis(p.id, now).catch(() => undefined);
  }
}
export function startAnalysisWorker(log: { error: (error: unknown, message: string) => void }) {
  let running: Promise<void> | null = null;
  const run = () => { if (!running) running = analysisTick().catch(e => log.error(e, "Falha no ciclo analítico; nova tentativa automática.")).finally(() => { running = null; }); };
  const timer = setInterval(run, 10000);
  timer.unref(); run();
  return async () => { clearInterval(timer); await running; };
}

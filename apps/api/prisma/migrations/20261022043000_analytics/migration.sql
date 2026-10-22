-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "coverageConfirmedBy" UUID,
ADD COLUMN     "coverageEnd" DATE,
ADD COLUMN     "coverageOngoing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "coverageStart" DATE,
ADD COLUMN     "leadTimeDays" INTEGER,
ADD COLUMN     "minimumKnown" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "positionOn" DATE,
ADD COLUMN     "safetyDays" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "analysisAttemptAt" TIMESTAMP(3),
ADD COLUMN     "analysisError" VARCHAR(300),
ADD COLUMN     "analysisPending" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "expiryWarningDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "inactivityDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "policyVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "reorderDays" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "consumptionConfirmed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "originalLine" INTEGER,
ADD COLUMN     "originalReference" VARCHAR(180),
ADD COLUMN     "originalResponsible" VARCHAR(120);

-- CreateTable
CREATE TABLE "AnalysisSnapshot" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "ruleVersion" VARCHAR(40) NOT NULL,
    "referenceDay" CHAR(10) NOT NULL,
    "timezone" VARCHAR(80) NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertOccurrence" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "identity" VARCHAR(160) NOT NULL,
    "productId" UUID NOT NULL,
    "lotId" UUID,
    "rule" VARCHAR(40) NOT NULL,
    "priority" VARCHAR(12) NOT NULL,
    "evidence" JSONB NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "previousId" UUID,
    "actionState" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "actionVersion" INTEGER NOT NULL DEFAULT 0,
    "assigneeId" UUID,
    "assigneeName" VARCHAR(120),

    CONSTRAINT "AlertOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisEvent" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "alertId" UUID,
    "productId" UUID,
    "kind" VARCHAR(30) NOT NULL,
    "actorId" UUID,
    "actorName" VARCHAR(120) NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalysisSnapshot_propertyId_createdAt_idx" ON "AnalysisSnapshot"("propertyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisSnapshot_propertyId_revision_policyVersion_referenc_key" ON "AnalysisSnapshot"("propertyId", "revision", "policyVersion", "referenceDay", "ruleVersion");

-- CreateIndex
CREATE INDEX "AlertOccurrence_propertyId_closedAt_idx" ON "AlertOccurrence"("propertyId", "closedAt");

-- CreateIndex
CREATE INDEX "AlertOccurrence_propertyId_identity_idx" ON "AlertOccurrence"("propertyId", "identity");

-- CreateIndex
CREATE INDEX "AnalysisEvent_propertyId_alertId_createdAt_idx" ON "AnalysisEvent"("propertyId", "alertId", "createdAt");

-- AddForeignKey
ALTER TABLE "AnalysisSnapshot" ADD CONSTRAINT "AnalysisSnapshot_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertOccurrence" ADD CONSTRAINT "AlertOccurrence_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisEvent" ADD CONSTRAINT "AnalysisEvent_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Um único episódio ativo por regra/entidade; episódios encerrados são preservados.
CREATE UNIQUE INDEX "AlertOccurrence_one_active" ON "AlertOccurrence"("propertyId", "identity") WHERE "closedAt" IS NULL;
ALTER TABLE "Property" ADD CONSTRAINT "analysis_policy_bounds" CHECK ("reorderDays" BETWEEN 1 AND 730 AND "expiryWarningDays" BETWEEN 1 AND 365 AND "inactivityDays" BETWEEN 7 AND 730);
ALTER TABLE "Product" ADD CONSTRAINT "analysis_coverage_bounds" CHECK (("coverageStart" IS NULL AND "coverageEnd" IS NULL AND NOT "coverageOngoing") OR ("coverageStart" IS NOT NULL AND "coverageEnd" IS NOT NULL AND "coverageStart" <= "coverageEnd"));
UPDATE "Product" SET "minimumKnown" = true WHERE "minimum" > 0;
-- O formato antigo não distinguia saída genérica de uso no histórico importado.
UPDATE "StockMovement" SET "consumptionConfirmed" = false WHERE "source" = 'IMPORT' AND "kind" = 'CONSUMPTION';

-- CreateEnum
CREATE TYPE "StockKind" AS ENUM ('OPENING', 'IN', 'CONSUMPTION', 'DISPOSAL', 'ADJUST_IN', 'ADJUST_OUT', 'REVERSAL');

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "inventoryRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "nameKey" VARCHAR(120) NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "unit" VARCHAR(10) NOT NULL,
    "minimum" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLot" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "expiresOn" DATE,
    "expiryStatus" VARCHAR(12) NOT NULL DEFAULT 'UNKNOWN',
    "unitCost" DECIMAL(18,4),
    "supplier" VARCHAR(120),
    "balance" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "kind" "StockKind" NOT NULL,
    "delta" DECIMAL(18,3) NOT NULL,
    "unitCost" DECIMAL(18,4),
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" UUID NOT NULL,
    "actorName" VARCHAR(120) NOT NULL,
    "destination" VARCHAR(120),
    "notes" VARCHAR(500),
    "source" VARCHAR(12) NOT NULL,
    "requestKey" VARCHAR(100) NOT NULL,
    "reversalOf" UUID,
    "importBatchId" UUID,
    "fingerprint" CHAR(64),

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockRequest" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "hash" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fileName" VARCHAR(180) NOT NULL,
    "fileHash" CHAR(64) NOT NULL,
    "mode" VARCHAR(12) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "preview" JSONB,
    "model" VARCHAR(100),
    "analysisNote" VARCHAR(500),
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_propertyId_archived_idx" ON "Product"("propertyId", "archived");

-- CreateIndex
CREATE UNIQUE INDEX "Product_propertyId_nameKey_key" ON "Product"("propertyId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "StockLot_productId_code_key" ON "StockLot"("productId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_reversalOf_key" ON "StockMovement"("reversalOf");

-- CreateIndex
CREATE INDEX "StockMovement_productId_occurredAt_idx" ON "StockMovement"("productId", "occurredAt");

-- CreateIndex
CREATE INDEX "StockMovement_lotId_occurredAt_idx" ON "StockMovement"("lotId", "occurredAt");

-- CreateIndex
CREATE INDEX "StockMovement_fingerprint_idx" ON "StockMovement"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "StockRequest_propertyId_key_key" ON "StockRequest"("propertyId", "key");

-- CreateIndex
CREATE INDEX "ImportBatch_propertyId_fileHash_idx" ON "ImportBatch"("propertyId", "fileHash");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

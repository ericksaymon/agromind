CREATE TABLE "WhatsappPairAttempt" (
 "eventKey" VARCHAR(64) NOT NULL, "phoneHash" CHAR(64) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "WhatsappPairAttempt_pkey" PRIMARY KEY ("eventKey")
);
CREATE INDEX "WhatsappPairAttempt_phoneHash_createdAt_idx" ON "WhatsappPairAttempt"("phoneHash", "createdAt");
CREATE INDEX "WhatsappPairAttempt_createdAt_idx" ON "WhatsappPairAttempt"("createdAt");

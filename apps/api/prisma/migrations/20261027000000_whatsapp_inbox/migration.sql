CREATE TABLE "WhatsappInboxEvent" (
  "eventKey" VARCHAR(64) NOT NULL,
  "accountId" VARCHAR(40) NOT NULL,
  "phoneNumberId" VARCHAR(40) NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "encrypted" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "WhatsappInboxEvent_pkey" PRIMARY KEY ("eventKey")
);
CREATE INDEX "WhatsappInboxEvent_receivedAt_idx" ON "WhatsappInboxEvent"("receivedAt");
CREATE INDEX "WhatsappInboxEvent_processedAt_receivedAt_idx" ON "WhatsappInboxEvent"("processedAt", "receivedAt");

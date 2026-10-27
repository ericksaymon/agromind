ALTER TABLE "WhatsappInboxEvent" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "lastError" VARCHAR(40);
CREATE TABLE "WhatsappConnection" (
 "id" UUID NOT NULL, "userId" UUID NOT NULL, "propertyId" UUID NOT NULL,
 "phoneHash" CHAR(64) NOT NULL, "encryptedPhone" TEXT NOT NULL, "lastDigits" VARCHAR(4) NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "lastMessageAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "WhatsappConnection_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "WhatsappConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "WhatsappConnection_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WhatsappConnection_userId_key" ON "WhatsappConnection"("userId");
CREATE UNIQUE INDEX "WhatsappConnection_phoneHash_key" ON "WhatsappConnection"("phoneHash");
CREATE TABLE "WhatsappPairCode" (
 "hash" CHAR(64) NOT NULL, "sessionId" UUID NOT NULL, "propertyId" UUID NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL, "usedAt" TIMESTAMP(3),
 CONSTRAINT "WhatsappPairCode_pkey" PRIMARY KEY ("hash"),
 CONSTRAINT "WhatsappPairCode_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "WhatsappPairCode_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WhatsappPairCode_expiresAt_idx" ON "WhatsappPairCode"("expiresAt");
CREATE TABLE "WhatsappReply" (
 "id" UUID NOT NULL, "eventKey" VARCHAR(64) NOT NULL, "encrypted" TEXT NOT NULL,
 "connectionId" UUID, "connectionVersion" INTEGER, "status" VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
 "externalId" VARCHAR(512), "errorCode" VARCHAR(40), "expiresAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "WhatsappReply_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsappReply_eventKey_key" ON "WhatsappReply"("eventKey");
CREATE UNIQUE INDEX "WhatsappReply_externalId_key" ON "WhatsappReply"("externalId");
CREATE INDEX "WhatsappReply_status_createdAt_idx" ON "WhatsappReply"("status", "createdAt");

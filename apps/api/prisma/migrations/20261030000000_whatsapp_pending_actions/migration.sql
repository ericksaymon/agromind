CREATE TABLE "WhatsappPendingAction" (
 "id" UUID NOT NULL, "connectionId" UUID NOT NULL, "connectionVersion" INTEGER NOT NULL,
 "kind" VARCHAR(12) NOT NULL, "encrypted" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "WhatsappPendingAction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsappPendingAction_connectionId_key" ON "WhatsappPendingAction"("connectionId");
ALTER TABLE "WhatsappPendingAction" ADD CONSTRAINT "WhatsappPendingAction_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WhatsappConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

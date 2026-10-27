ALTER TABLE "WhatsappReply" ADD COLUMN "recipientHash" CHAR(64);
CREATE INDEX "WhatsappReply_recipientHash_createdAt_idx" ON "WhatsappReply"("recipientHash", "createdAt");

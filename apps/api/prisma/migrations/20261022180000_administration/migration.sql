BEGIN;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE FUNCTION agromind_category_key(value text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT trim(regexp_replace(lower(unaccent(value)), '[^a-z0-9]+', ' ', 'g')) $$;
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM "Product" GROUP BY "propertyId", agromind_category_key(category) HAVING count(DISTINCT category)>1) THEN
RAISE EXCEPTION 'CATEGORY_COLLISION: resolve normalized legacy category names before migration';
END IF; END $$;
-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "role" SET DEFAULT 'VIEWER';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "categoryId" UUID;

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "settingsVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "reauthenticatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "profileVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "nameKey" VARCHAR(80) NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdministrativeEvent" (
    "id" UUID NOT NULL,
    "propertyId" UUID,
    "userId" UUID NOT NULL,
    "actorName" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "details" JSONB NOT NULL,
    "correlation" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdministrativeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "hash" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "role" "Role" NOT NULL,
    "issuerId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "predecessorId" UUID,
    "acceptedBy" UUID,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailOutbox" (
    "id" UUID NOT NULL,
    "intent" VARCHAR(100) NOT NULL,
    "invitationId" UUID,
    "encrypted" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailChangeRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "oldEmail" VARCHAR(254) NOT NULL,
    "newEmail" VARCHAR(254) NOT NULL,
    "oldTokenHash" CHAR(64) NOT NULL,
    "newTokenHash" CHAR(64) NOT NULL,
    "oldConfirmedAt" TIMESTAMP(3),
    "newConfirmedAt" TIMESTAMP(3),
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_propertyId_nameKey_key" ON "Category"("propertyId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "Category_propertyId_id_key" ON "Category"("propertyId", "id");

-- CreateIndex
CREATE INDEX "AdministrativeEvent_propertyId_createdAt_id_idx" ON "AdministrativeEvent"("propertyId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AdministrativeEvent_userId_createdAt_id_idx" ON "AdministrativeEvent"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AccountRequest_userId_key_key" ON "AccountRequest"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_propertyId_createdAt_id_idx" ON "Invitation"("propertyId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MailOutbox_intent_key" ON "MailOutbox"("intent");

-- CreateIndex
CREATE INDEX "MailOutbox_status_nextAttemptAt_idx" ON "MailOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailChangeRequest_oldTokenHash_key" ON "EmailChangeRequest"("oldTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "EmailChangeRequest_newTokenHash_key" ON "EmailChangeRequest"("newTokenHash");

-- CreateIndex
CREATE INDEX "EmailChangeRequest_userId_status_idx" ON "EmailChangeRequest"("userId", "status");

ALTER TABLE "Category" ADD CONSTRAINT "Category_property_fk" FOREIGN KEY ("propertyId") REFERENCES "Property"(id) ON DELETE CASCADE;
INSERT INTO "Category" (id,"propertyId",name,"nameKey") SELECT gen_random_uuid(),"propertyId",category,agromind_category_key(category) FROM "Product" GROUP BY "propertyId",category;
INSERT INTO "Category" (id,"propertyId",name,"nameKey") SELECT gen_random_uuid(),p.id,n,agromind_category_key(n) FROM "Property" p CROSS JOIN unnest(ARRAY['Combustíveis','Lubrificantes','Fertilizantes','Corretivos','Sementes','Defensivos e biológicos','Peças e manutenção','Irrigação','EPI','Outros']) n ON CONFLICT ("propertyId","nameKey") DO NOTHING;
UPDATE "Product" p SET "categoryId"=c.id FROM "Category" c WHERE p."propertyId"=c."propertyId" AND agromind_category_key(p.category)=c."nameKey";
ALTER TABLE "Product" ALTER COLUMN "categoryId" SET NOT NULL;
ALTER TABLE "Product" ADD CONSTRAINT "Product_category_scope_fk" FOREIGN KEY ("propertyId","categoryId") REFERENCES "Category"("propertyId",id);
CREATE FUNCTION agromind_seed_categories() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
INSERT INTO "Category"(id,"propertyId",name,"nameKey") SELECT gen_random_uuid(),NEW.id,n,agromind_category_key(n) FROM unnest(ARRAY['Combustíveis','Lubrificantes','Fertilizantes','Corretivos','Sementes','Defensivos e biológicos','Peças e manutenção','Irrigação','EPI','Outros']) n;
RETURN NEW; END $$;
CREATE TRIGGER property_seed_categories AFTER INSERT ON "Property" FOR EACH ROW EXECUTE FUNCTION agromind_seed_categories();
-- Compatibility for trusted legacy seeds. API services resolve active catalog entries before writing.
CREATE FUNCTION agromind_product_category() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE chosen "Category"; BEGIN
IF NEW."categoryId" IS NULL THEN
SELECT * INTO chosen FROM "Category" WHERE "propertyId"=NEW."propertyId" AND "nameKey"=agromind_category_key(NEW.category);
IF chosen.id IS NULL THEN RAISE EXCEPTION 'CATEGORY_REQUIRED: create category explicitly'; END IF;
NEW."categoryId"=chosen.id;
ELSE SELECT * INTO chosen FROM "Category" WHERE id=NEW."categoryId" AND "propertyId"=NEW."propertyId";
IF chosen.id IS NULL THEN RAISE EXCEPTION 'CATEGORY_SCOPE'; END IF;
END IF;
NEW.category=chosen.name;
RETURN NEW; END $$;
CREATE TRIGGER product_category_projection BEFORE INSERT OR UPDATE OF "categoryId",category,"propertyId" ON "Product" FOR EACH ROW EXECUTE FUNCTION agromind_product_category();
CREATE UNIQUE INDEX invitation_active_target ON "Invitation"("propertyId",email) WHERE status='PENDING';
CREATE UNIQUE INDEX invitation_queued_target ON "Invitation"("propertyId",email) WHERE status='QUEUED';
ALTER TABLE "Invitation" ADD CONSTRAINT invitation_property_fk FOREIGN KEY ("propertyId") REFERENCES "Property"(id) ON DELETE CASCADE;
ALTER TABLE "EmailChangeRequest" ADD CONSTRAINT email_change_user_fk FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE;
ALTER TABLE "AccountRequest" ADD CONSTRAINT account_request_user_fk FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE;
ALTER TABLE "MailOutbox" ADD CONSTRAINT outbox_invitation_fk FOREIGN KEY ("invitationId") REFERENCES "Invitation"(id) ON DELETE CASCADE;
COMMIT;

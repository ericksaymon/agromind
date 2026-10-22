ALTER TABLE "Property" ADD COLUMN "intelligencePolicy" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Property" ADD CONSTRAINT "intelligence_policy_object" CHECK (jsonb_typeof("intelligencePolicy") = 'object');
UPDATE "Property" SET "analysisPending" = true;

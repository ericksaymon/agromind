BEGIN;
-- Match JavaScript NFD + combining-mark removal exactly, including non-Latin ligatures.
CREATE OR REPLACE FUNCTION agromind_category_key(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT trim(regexp_replace(lower(regexp_replace(normalize(value,NFD), '[̀-ͯ]', '', 'g')), '[^a-z0-9]+', ' ', 'g'))
$$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "Category" GROUP BY "propertyId",agromind_category_key(name) HAVING count(*)>1) THEN
  RAISE EXCEPTION 'CATEGORY_COLLISION: resolve normalized category names before cutover';
 END IF;
 IF EXISTS (SELECT 1 FROM "Category" WHERE agromind_category_key(name)='') THEN
  RAISE EXCEPTION 'CATEGORY_INVALID: resolve legacy names without a normalized key';
 END IF;
END $$;
UPDATE "Category" SET "nameKey"=agromind_category_key(name) WHERE "nameKey"<>agromind_category_key(name);
COMMIT;

CREATE TYPE "MediaAccessClass" AS ENUM ('PUBLIC', 'ADMIN_ONLY');
ALTER TABLE "Media" ADD COLUMN "accessClass" "MediaAccessClass";

-- Fail closed for ambiguous legacy data. Referenced settlement receipts are
-- sensitive; public consumers establish PUBLIC intent. Unreferenced rows need
-- an operator-owned classification and must not be guessed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Media" m WHERE
    (EXISTS (SELECT 1 FROM "OrderSettlement" s WHERE s."receiptMediaId" = m."id") AND
     EXISTS (SELECT 1 FROM "Product" p WHERE p."imageMediaId" = m."id"
       UNION ALL SELECT 1 FROM "Blog" b WHERE b."coverMediaId" = m."id"
       UNION ALL SELECT 1 FROM "BlogAuthor" a WHERE a."avatarMediaId" = m."id"
       UNION ALL SELECT 1 FROM "BlogInlineMedia" i WHERE i."mediaId" = m."id"))
    OR NOT EXISTS (SELECT 1 FROM "OrderSettlement" s WHERE s."receiptMediaId" = m."id"
       UNION ALL SELECT 1 FROM "Product" p WHERE p."imageMediaId" = m."id"
       UNION ALL SELECT 1 FROM "Blog" b WHERE b."coverMediaId" = m."id"
       UNION ALL SELECT 1 FROM "BlogAuthor" a WHERE a."avatarMediaId" = m."id"
       UNION ALL SELECT 1 FROM "BlogInlineMedia" i WHERE i."mediaId" = m."id"))
  THEN RAISE EXCEPTION 'MED-02 preflight failed: ambiguous legacy Media rows require classification'; END IF;
END $$;

UPDATE "Media" m SET "accessClass" = 'ADMIN_ONLY'
WHERE EXISTS (SELECT 1 FROM "OrderSettlement" s WHERE s."receiptMediaId" = m."id");
UPDATE "Media" SET "accessClass" = 'PUBLIC' WHERE "accessClass" IS NULL;
ALTER TABLE "Media" ALTER COLUMN "accessClass" SET NOT NULL;

CREATE OR REPLACE FUNCTION "Media_accessClass_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."accessClass" IS DISTINCT FROM OLD."accessClass" THEN
    RAISE EXCEPTION 'Media accessClass is immutable after creation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Media_accessClass_immutable_trigger"
BEFORE UPDATE OF "accessClass" ON "Media"
FOR EACH ROW EXECUTE FUNCTION "Media_accessClass_immutable"();

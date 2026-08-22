-- PRC-02: Discount model with PERCENT/FIXED types, targets, activation window,
-- and explicit lifecycle. Additive only: new enums, table, indexes, and CHECKs.
-- No Order discount snapshots yet. Rollback while unused:
-- DROP TABLE "Discount"; DROP TYPE "DiscountTarget"; DROP TYPE "DiscountType";

CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');

CREATE TYPE "DiscountTarget" AS ENUM ('ORDER', 'PRODUCT', 'CATEGORY');

CREATE TABLE "Discount" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" "DiscountType" NOT NULL,
    "target" "DiscountTarget" NOT NULL,
    "percentValue" INTEGER,
    "fixedAmount" INTEGER,
    "productId" UUID,
    "categoryId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "precedence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Discount_pkey" PRIMARY KEY ("id")
);

-- Trimmed, non-empty display label. Application also trims on write.
ALTER TABLE "Discount"
ADD CONSTRAINT "Discount_name_trimmed_check"
CHECK (
    "name" = btrim("name")
    AND char_length("name") BETWEEN 1 AND 100
);

-- PERCENT: whole-number percentage 1–100; FIXED: positive integer Toman only.
ALTER TABLE "Discount"
ADD CONSTRAINT "Discount_percent_type_check"
CHECK (
    ("type" = 'PERCENT' AND "percentValue" IS NOT NULL AND "percentValue" >= 1 AND "percentValue" <= 100 AND "fixedAmount" IS NULL)
    OR
    ("type" = 'FIXED' AND "fixedAmount" IS NOT NULL AND "fixedAmount" > 0 AND "percentValue" IS NULL)
);

-- Target scope: exactly one FK pattern per target enum value.
ALTER TABLE "Discount"
ADD CONSTRAINT "Discount_target_scope_check"
CHECK (
    ("target" = 'ORDER' AND "productId" IS NULL AND "categoryId" IS NULL)
    OR
    ("target" = 'PRODUCT' AND "productId" IS NOT NULL AND "categoryId" IS NULL)
    OR
    ("target" = 'CATEGORY' AND "categoryId" IS NOT NULL AND "productId" IS NULL)
);

-- Optional activation window: when both bounds exist, start must precede end.
ALTER TABLE "Discount"
ADD CONSTRAINT "Discount_window_check"
CHECK (
    "startsAt" IS NULL
    OR "endsAt" IS NULL
    OR "startsAt" < "endsAt"
);

ALTER TABLE "Discount"
ADD CONSTRAINT "Discount_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Discount"
ADD CONSTRAINT "Discount_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Discount_isActive_createdAt_idx" ON "Discount"("isActive", "createdAt");
CREATE INDEX "Discount_target_isActive_idx" ON "Discount"("target", "isActive");
CREATE INDEX "Discount_productId_idx" ON "Discount"("productId");
CREATE INDEX "Discount_categoryId_idx" ON "Discount"("categoryId");

-- DLU-02 / ADR 0017: PRODUCT discount lifetime quantity caps + usage accounting.
-- Additive/forward-safe: new Discount column, usage aggregate, append-only usage
-- records, and OrderLine.discountedQuantity snapshot. Historical lines are
-- backfilled (0 when no LINE discount; full quantity when a LINE discount applied).
-- Human approval remains required before shared/prod migrate deploy.
-- Rollback while unused (dev only):
--   ALTER TABLE "OrderLine" DROP CONSTRAINT "OrderLine_discountedQuantity_check";
--   ALTER TABLE "OrderLine" DROP COLUMN "discountedQuantity";
--   DROP TABLE "DiscountUsageRecord"; DROP TYPE "DiscountUsageRecordKind";
--   DROP TABLE "DiscountCustomerUsage";
--   ALTER TABLE "Discount" DROP CONSTRAINT "Discount_maxQuantityPerCustomer_check";
--   ALTER TABLE "Discount" DROP COLUMN "maxQuantityPerCustomer";

-- Optional per-customer lifetime discounted-quantity cap (PRODUCT only; null = unlimited).
ALTER TABLE "Discount"
ADD COLUMN "maxQuantityPerCustomer" INTEGER;

ALTER TABLE "Discount"
ADD CONSTRAINT "Discount_maxQuantityPerCustomer_check"
CHECK (
    "maxQuantityPerCustomer" IS NULL
    OR (
        "target" = 'PRODUCT'
        AND "maxQuantityPerCustomer" >= 1
    )
);

-- Aggregate consumed quantity per (discountId, userId).
CREATE TABLE "DiscountCustomerUsage" (
    "discountId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "consumedQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DiscountCustomerUsage_pkey" PRIMARY KEY ("discountId", "userId")
);

ALTER TABLE "DiscountCustomerUsage"
ADD CONSTRAINT "DiscountCustomerUsage_consumedQuantity_check"
CHECK ("consumedQuantity" >= 0);

ALTER TABLE "DiscountCustomerUsage"
ADD CONSTRAINT "DiscountCustomerUsage_discountId_fkey"
FOREIGN KEY ("discountId") REFERENCES "Discount"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DiscountCustomerUsage"
ADD CONSTRAINT "DiscountCustomerUsage_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "DiscountCustomerUsage_userId_discountId_idx"
ON "DiscountCustomerUsage"("userId", "discountId");

-- Append-only CONSUME/RELEASE evidence. Uniqueness prevents double consume/release.
CREATE TYPE "DiscountUsageRecordKind" AS ENUM ('CONSUME', 'RELEASE');

CREATE TABLE "DiscountUsageRecord" (
    "id" UUID NOT NULL,
    "discountId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "kind" "DiscountUsageRecordKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountUsageRecord_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DiscountUsageRecord"
ADD CONSTRAINT "DiscountUsageRecord_quantity_check"
CHECK ("quantity" >= 1);

ALTER TABLE "DiscountUsageRecord"
ADD CONSTRAINT "DiscountUsageRecord_discountId_fkey"
FOREIGN KEY ("discountId") REFERENCES "Discount"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DiscountUsageRecord"
ADD CONSTRAINT "DiscountUsageRecord_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "DiscountUsageRecord_orderId_discountId_kind_key"
ON "DiscountUsageRecord"("orderId", "discountId", "kind");

CREATE INDEX "DiscountUsageRecord_discountId_userId_createdAt_idx"
ON "DiscountUsageRecord"("discountId", "userId", "createdAt");

CREATE INDEX "DiscountUsageRecord_orderId_idx"
ON "DiscountUsageRecord"("orderId");

-- Historical LINE snapshot: units that received the LINE discount (0…quantity).
ALTER TABLE "OrderLine"
ADD COLUMN "discountedQuantity" INTEGER;

-- Pre-DLU reconstruction: no LINE discount → 0; otherwise full line quantity.
UPDATE "OrderLine"
SET "discountedQuantity" = CASE
    WHEN "lineDiscountAmount" = 0 THEN 0
    ELSE "quantity"
END
WHERE "discountedQuantity" IS NULL;

ALTER TABLE "OrderLine"
ALTER COLUMN "discountedQuantity" SET NOT NULL;

ALTER TABLE "OrderLine"
ADD CONSTRAINT "OrderLine_discountedQuantity_check"
CHECK (
    "discountedQuantity" >= 0
    AND "discountedQuantity" <= "quantity"
);

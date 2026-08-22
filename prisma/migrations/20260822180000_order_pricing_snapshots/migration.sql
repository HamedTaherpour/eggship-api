-- ORD-03: Order/OrderLine pricing + discount snapshot columns.
-- Additive/forward-safe: renames ORD-01 gross money columns, adds discounted
-- amounts and applied-discount evidence. No FK to Discount (historical only).
-- Assumes no production Orders yet (ORD-03 create path lands with this migration).
-- Rollback while unused:
--   reverse renames/drops added columns; restore ORD-01 CHECKs from
--   20260822150000_order_persistence.

-- ---------------------------------------------------------------------------
-- OrderLine: lineTotal → grossLineTotal + discount columns
-- ---------------------------------------------------------------------------

ALTER TABLE "OrderLine"
DROP CONSTRAINT "OrderLine_lineTotal_matches_unitPrice_quantity_check";

ALTER TABLE "OrderLine"
DROP CONSTRAINT "OrderLine_lineTotal_non_negative_check";

ALTER TABLE "OrderLine"
RENAME COLUMN "lineTotal" TO "grossLineTotal";

ALTER TABLE "OrderLine"
ADD COLUMN "lineDiscountAmount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "finalLineTotal" BIGINT,
ADD COLUMN "appliedLineDiscountId" UUID,
ADD COLUMN "appliedLineDiscountName" VARCHAR(100),
ADD COLUMN "appliedLineDiscountType" "DiscountType",
ADD COLUMN "appliedLineDiscountTarget" "DiscountTarget",
ADD COLUMN "appliedLineDiscountPercentValue" INTEGER,
ADD COLUMN "appliedLineDiscountFixedAmount" INTEGER,
ADD COLUMN "appliedLineDiscountPrecedence" INTEGER,
ADD COLUMN "appliedLineDiscountProductId" UUID,
ADD COLUMN "appliedLineDiscountCategoryId" UUID;

-- Backfill finalLineTotal for any pre-existing ORD-01 rows (gross only).
UPDATE "OrderLine"
SET "finalLineTotal" = "grossLineTotal"
WHERE "finalLineTotal" IS NULL;

ALTER TABLE "OrderLine"
ALTER COLUMN "finalLineTotal" SET NOT NULL;

ALTER TABLE "OrderLine"
ALTER COLUMN "lineDiscountAmount" DROP DEFAULT;

ALTER TABLE "OrderLine"
ADD CONSTRAINT "OrderLine_grossLineTotal_matches_unitPrice_quantity_check"
CHECK ("grossLineTotal" = ("unitPrice"::bigint * "quantity"));

ALTER TABLE "OrderLine"
ADD CONSTRAINT "OrderLine_grossLineTotal_non_negative_check"
CHECK ("grossLineTotal" >= 0);

ALTER TABLE "OrderLine"
ADD CONSTRAINT "OrderLine_lineDiscountAmount_non_negative_check"
CHECK ("lineDiscountAmount" >= 0);

ALTER TABLE "OrderLine"
ADD CONSTRAINT "OrderLine_finalLineTotal_matches_gross_minus_discount_check"
CHECK ("finalLineTotal" = ("grossLineTotal" - "lineDiscountAmount"));

ALTER TABLE "OrderLine"
ADD CONSTRAINT "OrderLine_finalLineTotal_non_negative_check"
CHECK ("finalLineTotal" >= 0);

ALTER TABLE "OrderLine"
ADD CONSTRAINT "OrderLine_applied_line_discount_null_consistency_check"
CHECK (
    (
        "appliedLineDiscountId" IS NULL
        AND "appliedLineDiscountName" IS NULL
        AND "appliedLineDiscountType" IS NULL
        AND "appliedLineDiscountTarget" IS NULL
        AND "appliedLineDiscountPercentValue" IS NULL
        AND "appliedLineDiscountFixedAmount" IS NULL
        AND "appliedLineDiscountPrecedence" IS NULL
        AND "appliedLineDiscountProductId" IS NULL
        AND "appliedLineDiscountCategoryId" IS NULL
        AND "lineDiscountAmount" = 0
    )
    OR (
        "appliedLineDiscountId" IS NOT NULL
        AND "appliedLineDiscountName" IS NOT NULL
        AND btrim("appliedLineDiscountName") = "appliedLineDiscountName"
        AND char_length("appliedLineDiscountName") BETWEEN 1 AND 100
        AND "appliedLineDiscountType" IS NOT NULL
        AND "appliedLineDiscountTarget" IN ('PRODUCT'::"DiscountTarget", 'CATEGORY'::"DiscountTarget")
        AND "appliedLineDiscountPrecedence" IS NOT NULL
        AND (
            (
                "appliedLineDiscountType" = 'PERCENT'::"DiscountType"
                AND "appliedLineDiscountPercentValue" BETWEEN 1 AND 100
                AND "appliedLineDiscountFixedAmount" IS NULL
            )
            OR (
                "appliedLineDiscountType" = 'FIXED'::"DiscountType"
                AND "appliedLineDiscountFixedAmount" IS NOT NULL
                AND "appliedLineDiscountFixedAmount" > 0
                AND "appliedLineDiscountPercentValue" IS NULL
            )
        )
        AND "lineDiscountAmount" >= 0
    )
);

-- ---------------------------------------------------------------------------
-- Order: subtotal → grossSubtotal + discount aggregates + pricing evidence
-- ---------------------------------------------------------------------------

ALTER TABLE "Order"
DROP CONSTRAINT "Order_subtotal_non_negative_check";

ALTER TABLE "Order"
RENAME COLUMN "subtotal" TO "grossSubtotal";

ALTER TABLE "Order"
ADD COLUMN "lineDiscountTotal" BIGINT,
ADD COLUMN "subtotalAfterLineDiscounts" BIGINT,
ADD COLUMN "orderDiscountAmount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "pricingEvaluatedAt" TIMESTAMPTZ(3),
ADD COLUMN "appliedOrderDiscountId" UUID,
ADD COLUMN "appliedOrderDiscountName" VARCHAR(100),
ADD COLUMN "appliedOrderDiscountType" "DiscountType",
ADD COLUMN "appliedOrderDiscountPercentValue" INTEGER,
ADD COLUMN "appliedOrderDiscountFixedAmount" INTEGER,
ADD COLUMN "appliedOrderDiscountPrecedence" INTEGER,
ADD COLUMN "idempotencyPayloadHash" VARCHAR(64);

-- Backfill pre-ORD-03 rows (no discounts; pricing instant ≈ createdAt).
-- Clear unused ORD-01 idempotency keys that lack a payload hash so the new
-- consistency CHECK can be applied (ORD-03 create was not live yet).
UPDATE "Order"
SET
    "lineDiscountTotal" = 0,
    "subtotalAfterLineDiscounts" = "grossSubtotal",
    "orderDiscountAmount" = 0,
    "total" = "grossSubtotal",
    "pricingEvaluatedAt" = "createdAt",
    "idempotencyKey" = NULL,
    "idempotencyPayloadHash" = NULL
WHERE "lineDiscountTotal" IS NULL
   OR "subtotalAfterLineDiscounts" IS NULL
   OR "pricingEvaluatedAt" IS NULL
   OR ("idempotencyKey" IS NOT NULL AND "idempotencyPayloadHash" IS NULL)
   OR "total" IS DISTINCT FROM "grossSubtotal";

ALTER TABLE "Order"
ALTER COLUMN "lineDiscountTotal" SET NOT NULL,
ALTER COLUMN "subtotalAfterLineDiscounts" SET NOT NULL,
ALTER COLUMN "pricingEvaluatedAt" SET NOT NULL;

ALTER TABLE "Order"
ALTER COLUMN "orderDiscountAmount" DROP DEFAULT;

ALTER TABLE "Order"
ADD CONSTRAINT "Order_grossSubtotal_non_negative_check"
CHECK ("grossSubtotal" >= 0);

ALTER TABLE "Order"
ADD CONSTRAINT "Order_lineDiscountTotal_non_negative_check"
CHECK ("lineDiscountTotal" >= 0);

ALTER TABLE "Order"
ADD CONSTRAINT "Order_subtotalAfterLineDiscounts_non_negative_check"
CHECK ("subtotalAfterLineDiscounts" >= 0);

ALTER TABLE "Order"
ADD CONSTRAINT "Order_orderDiscountAmount_non_negative_check"
CHECK ("orderDiscountAmount" >= 0);

ALTER TABLE "Order"
ADD CONSTRAINT "Order_subtotal_after_line_matches_gross_minus_line_discount_check"
CHECK ("subtotalAfterLineDiscounts" = ("grossSubtotal" - "lineDiscountTotal"));

ALTER TABLE "Order"
ADD CONSTRAINT "Order_total_matches_subtotal_minus_order_discount_check"
CHECK ("total" = ("subtotalAfterLineDiscounts" - "orderDiscountAmount"));

ALTER TABLE "Order"
ADD CONSTRAINT "Order_applied_order_discount_null_consistency_check"
CHECK (
    (
        "appliedOrderDiscountId" IS NULL
        AND "appliedOrderDiscountName" IS NULL
        AND "appliedOrderDiscountType" IS NULL
        AND "appliedOrderDiscountPercentValue" IS NULL
        AND "appliedOrderDiscountFixedAmount" IS NULL
        AND "appliedOrderDiscountPrecedence" IS NULL
        AND "orderDiscountAmount" = 0
    )
    OR (
        "appliedOrderDiscountId" IS NOT NULL
        AND "appliedOrderDiscountName" IS NOT NULL
        AND btrim("appliedOrderDiscountName") = "appliedOrderDiscountName"
        AND char_length("appliedOrderDiscountName") BETWEEN 1 AND 100
        AND "appliedOrderDiscountType" IS NOT NULL
        AND "appliedOrderDiscountPrecedence" IS NOT NULL
        AND (
            (
                "appliedOrderDiscountType" = 'PERCENT'::"DiscountType"
                AND "appliedOrderDiscountPercentValue" BETWEEN 1 AND 100
                AND "appliedOrderDiscountFixedAmount" IS NULL
            )
            OR (
                "appliedOrderDiscountType" = 'FIXED'::"DiscountType"
                AND "appliedOrderDiscountFixedAmount" IS NOT NULL
                AND "appliedOrderDiscountFixedAmount" > 0
                AND "appliedOrderDiscountPercentValue" IS NULL
            )
        )
        AND "orderDiscountAmount" >= 0
    )
);

ALTER TABLE "Order"
ADD CONSTRAINT "Order_idempotency_payload_hash_consistency_check"
CHECK (
    (
        "idempotencyKey" IS NULL
        AND "idempotencyPayloadHash" IS NULL
    )
    OR (
        "idempotencyKey" IS NOT NULL
        AND "idempotencyPayloadHash" IS NOT NULL
        AND char_length("idempotencyPayloadHash") = 64
        AND "idempotencyPayloadHash" ~ '^[0-9a-f]{64}$'
    )
);

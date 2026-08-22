-- ORD-01: Order and OrderLine persistence with historical snapshots.
-- Additive only: new enum, tables, FKs, indexes, and CHECK constraints.
-- No payment models. InventoryReservation.orderId remains opaque (no FK here).
-- Rollback while unused (before production orders / ORD-03 reservation coupling):
-- DROP TABLE IF EXISTS "OrderLine";
-- DROP TABLE IF EXISTS "Order";
-- DROP TYPE IF EXISTS "OrderStatus";

CREATE TYPE "OrderStatus" AS ENUM (
    'PENDING_REVIEW',
    'CONFIRMED',
    'SHIPPED',
    'DELIVERED',
    'CANCELLED',
    'RETURNED'
);

CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "customerPhone" VARCHAR(16) NOT NULL,
    "regionId" UUID NOT NULL,
    "regionName" VARCHAR(100) NOT NULL,
    "subtotal" BIGINT NOT NULL,
    "total" BIGINT NOT NULL,
    "idempotencyKey" UUID,
    "deliveryAt" TIMESTAMPTZ(3),
    "confirmedAt" TIMESTAMPTZ(3),
    "shippedAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Order"
ADD CONSTRAINT "Order_customerPhone_trimmed_check"
CHECK (
    "customerPhone" = btrim("customerPhone")
    AND char_length("customerPhone") BETWEEN 1 AND 16
);

ALTER TABLE "Order"
ADD CONSTRAINT "Order_regionName_trimmed_check"
CHECK (
    "regionName" = btrim("regionName")
    AND char_length("regionName") BETWEEN 1 AND 100
);

ALTER TABLE "Order"
ADD CONSTRAINT "Order_customerPhone_canonical_check"
CHECK ("customerPhone" ~ '^\+989[0-9]{9}$');

ALTER TABLE "Order"
ADD CONSTRAINT "Order_subtotal_non_negative_check"
CHECK ("subtotal" >= 0);

ALTER TABLE "Order"
ADD CONSTRAINT "Order_total_non_negative_check"
CHECK ("total" >= 0);

ALTER TABLE "Order"
ADD CONSTRAINT "Order_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Order"
ADD CONSTRAINT "Order_regionId_fkey"
FOREIGN KEY ("regionId") REFERENCES "Region"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- ORD-03 idempotency: one logical order per (userId, idempotencyKey) when key is set.
-- PostgreSQL UNIQUE allows multiple NULL idempotencyKey rows per user.
CREATE UNIQUE INDEX "Order_userId_idempotencyKey_key"
ON "Order"("userId", "idempotencyKey");

CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");

CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

CREATE TABLE "OrderLine" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "productName" VARCHAR(100) NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotal" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "OrderLine"
ADD CONSTRAINT "OrderLine_productName_trimmed_check"
CHECK (
    "productName" = btrim("productName")
    AND char_length("productName") BETWEEN 1 AND 100
);

ALTER TABLE "OrderLine"
ADD CONSTRAINT "OrderLine_unitPrice_positive_check"
CHECK ("unitPrice" > 0);

ALTER TABLE "OrderLine"
ADD CONSTRAINT "OrderLine_quantity_positive_check"
CHECK ("quantity" > 0);

ALTER TABLE "OrderLine"
ADD CONSTRAINT "OrderLine_lineTotal_matches_unitPrice_quantity_check"
CHECK ("lineTotal" = ("unitPrice"::bigint * "quantity"));

ALTER TABLE "OrderLine"
ADD CONSTRAINT "OrderLine_lineTotal_non_negative_check"
CHECK ("lineTotal" >= 0);

ALTER TABLE "OrderLine"
ADD CONSTRAINT "OrderLine_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderLine"
ADD CONSTRAINT "OrderLine_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "OrderLine_orderId_productId_key"
ON "OrderLine"("orderId", "productId");

CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

CREATE INDEX "OrderLine_productId_idx" ON "OrderLine"("productId");

-- ORD-07 Slice 1: durable return inspection history and Order.returnedAt.
-- Additive only. Return rows are business history and use RESTRICT FKs.

ALTER TABLE "Order"
ADD COLUMN "returnedAt" TIMESTAMPTZ(3);

CREATE TABLE "OrderReturn" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "recordedByAdminId" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "idempotencyPayloadHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderReturn_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "OrderReturn"
ADD CONSTRAINT "OrderReturn_reason_trimmed_check"
CHECK (
    "reason" = btrim("reason")
    AND char_length("reason") BETWEEN 1 AND 500
);

ALTER TABLE "OrderReturn"
ADD CONSTRAINT "OrderReturn_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderReturn"
ADD CONSTRAINT "OrderReturn_recordedByAdminId_fkey"
FOREIGN KEY ("recordedByAdminId") REFERENCES "Admin"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "OrderReturn_idempotencyKey_key"
ON "OrderReturn"("idempotencyKey");

CREATE INDEX "OrderReturn_orderId_createdAt_id_idx"
ON "OrderReturn"("orderId", "createdAt", "id");

CREATE INDEX "OrderReturn_recordedByAdminId_createdAt_id_idx"
ON "OrderReturn"("recordedByAdminId", "createdAt", "id");

CREATE TABLE "OrderReturnLine" (
    "id" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "orderLineId" UUID NOT NULL,
    "sellableQuantity" INTEGER NOT NULL,
    "damagedQuantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderReturnLine_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "OrderReturnLine"
ADD CONSTRAINT "OrderReturnLine_sellableQuantity_non_negative_check"
CHECK ("sellableQuantity" >= 0);

ALTER TABLE "OrderReturnLine"
ADD CONSTRAINT "OrderReturnLine_damagedQuantity_non_negative_check"
CHECK ("damagedQuantity" >= 0);

ALTER TABLE "OrderReturnLine"
ADD CONSTRAINT "OrderReturnLine_quantity_positive_check"
CHECK (("sellableQuantity" + "damagedQuantity") > 0);

ALTER TABLE "OrderReturnLine"
ADD CONSTRAINT "OrderReturnLine_returnId_fkey"
FOREIGN KEY ("returnId") REFERENCES "OrderReturn"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderReturnLine"
ADD CONSTRAINT "OrderReturnLine_orderLineId_fkey"
FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "OrderReturnLine_returnId_orderLineId_key"
ON "OrderReturnLine"("returnId", "orderLineId");

CREATE INDEX "OrderReturnLine_returnId_createdAt_id_idx"
ON "OrderReturnLine"("returnId", "createdAt", "id");

CREATE INDEX "OrderReturnLine_orderLineId_createdAt_id_idx"
ON "OrderReturnLine"("orderLineId", "createdAt", "id");

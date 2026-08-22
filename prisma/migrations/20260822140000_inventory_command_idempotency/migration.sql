-- INV-02: Admin inventory command idempotency claims.

CREATE TYPE "InventoryCommandOperation" AS ENUM ('RECEIVE', 'ADJUST');

CREATE TYPE "InventoryCommandIdempotencyStatus" AS ENUM ('PENDING', 'COMPLETED');

CREATE TABLE "InventoryCommandIdempotency" (
    "id" UUID NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "operation" "InventoryCommandOperation" NOT NULL,
    "productId" UUID NOT NULL,
    "payloadHash" VARCHAR(64) NOT NULL,
    "status" "InventoryCommandIdempotencyStatus" NOT NULL,
    "onHandAfter" INTEGER,
    "reservedAfter" INTEGER,
    "ledgerId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryCommandIdempotency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryCommandIdempotency_idempotencyKey_key"
ON "InventoryCommandIdempotency"("idempotencyKey");

CREATE INDEX "InventoryCommandIdempotency_productId_createdAt_idx"
ON "InventoryCommandIdempotency"("productId", "createdAt");

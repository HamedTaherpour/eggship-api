-- SET-02 / ADR 0018: additive deferred-settlement persistence.
CREATE TYPE "OrderSettlementStatus" AS ENUM ('OPEN', 'SETTLED');

CREATE TABLE "OrderSettlement" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "status" "OrderSettlementStatus" NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "settledAt" TIMESTAMPTZ(3),
    "settledByAdminId" UUID,
    "receiptMediaId" UUID,
    "receiptAttachedAt" TIMESTAMPTZ(3),
    "receiptAttachedByAdminId" UUID,
    "createdByAdminId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrderSettlement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrderSettlement_status_check" CHECK (
      ("status" = 'OPEN' AND "settledAt" IS NULL AND "settledByAdminId" IS NULL)
      OR
      ("status" = 'SETTLED' AND "settledAt" IS NOT NULL AND "settledByAdminId" IS NOT NULL AND "receiptMediaId" IS NOT NULL)
    ),
    CONSTRAINT "OrderSettlement_receipt_provenance_check" CHECK (
      ("receiptMediaId" IS NULL AND "receiptAttachedAt" IS NULL AND "receiptAttachedByAdminId" IS NULL)
      OR
      ("receiptMediaId" IS NOT NULL AND "receiptAttachedAt" IS NOT NULL AND "receiptAttachedByAdminId" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "OrderSettlement_orderId_key" ON "OrderSettlement"("orderId");
CREATE INDEX "OrderSettlement_status_dueAt_idx" ON "OrderSettlement"("status", "dueAt");
CREATE INDEX "OrderSettlement_dueAt_id_idx" ON "OrderSettlement"("dueAt", "id");
CREATE INDEX "OrderSettlement_createdAt_id_idx" ON "OrderSettlement"("createdAt", "id");
CREATE INDEX "OrderSettlement_settledAt_id_idx" ON "OrderSettlement"("settledAt", "id");

ALTER TABLE "OrderSettlement" ADD CONSTRAINT "OrderSettlement_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderSettlement" ADD CONSTRAINT "OrderSettlement_settledByAdminId_fkey"
  FOREIGN KEY ("settledByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderSettlement" ADD CONSTRAINT "OrderSettlement_receiptMediaId_fkey"
  FOREIGN KEY ("receiptMediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderSettlement" ADD CONSTRAINT "OrderSettlement_receiptAttachedByAdminId_fkey"
  FOREIGN KEY ("receiptAttachedByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderSettlement" ADD CONSTRAINT "OrderSettlement_createdByAdminId_fkey"
  FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- INV-01B: Inventory balances, per-order reservations, and append-only ledger.
-- Additive: new enums and tables only. Product columns are unchanged.
-- Existing Product rows are backfilled with onHand=0, reserved=0 (no invented stock).
-- Rollback while unused: DROP TABLE ledger/reservation/inventory, then DROP TYPE enums.
-- Enum rollback after apply is not a value-level reverse (PostgreSQL cannot cheaply
-- remove enum values); recovery is drop-type while unused, or a forward-fix migration.

CREATE TYPE "InventoryReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'SHIPPED');

CREATE TYPE "InventoryLedgerType" AS ENUM (
    'RECEIVE',
    'ADJUST',
    'RESERVE',
    'RELEASE',
    'SHIP',
    'RETURN_TO_STOCK',
    'WRITE_OFF'
);

CREATE TYPE "InventoryLedgerReferenceType" AS ENUM (
    'ORDER',
    'RECEIVE',
    'ADJUSTMENT',
    'RETURN',
    'RECONCILIATION'
);

CREATE TYPE "InventoryLedgerActorType" AS ENUM ('USER', 'ADMIN', 'SYSTEM');

CREATE TABLE "Inventory" (
    "productId" UUID NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("productId")
);

ALTER TABLE "Inventory"
ADD CONSTRAINT "Inventory_onHand_non_negative_check"
CHECK ("onHand" >= 0);

ALTER TABLE "Inventory"
ADD CONSTRAINT "Inventory_reserved_non_negative_check"
CHECK ("reserved" >= 0);

ALTER TABLE "Inventory"
ADD CONSTRAINT "Inventory_reserved_lte_onHand_check"
CHECK ("reserved" <= "onHand");

ALTER TABLE "Inventory"
ADD CONSTRAINT "Inventory_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill every existing Product with a zero balance. Idempotent if re-run.
-- SHARE ROW EXCLUSIVE on Product is held until this migration transaction
-- commits (FK adds plus backfill). Catalog writes wait for that window; the
-- current catalog is small. New Products are ensured by application
-- composition, not by a database trigger.
INSERT INTO "Inventory" ("productId", "onHand", "reserved", "createdAt", "updatedAt")
SELECT "id", 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Product"
ON CONFLICT ("productId") DO NOTHING;

CREATE TABLE "InventoryReservation" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "InventoryReservationStatus" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InventoryReservation"
ADD CONSTRAINT "InventoryReservation_quantity_positive_check"
CHECK ("quantity" > 0);

ALTER TABLE "InventoryReservation"
ADD CONSTRAINT "InventoryReservation_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- One reservation row per order/product pair in V1. Status changes in place.
-- orderId is opaque: no FK to Orders (module does not exist yet).
CREATE UNIQUE INDEX "InventoryReservation_orderId_productId_key"
ON "InventoryReservation"("orderId", "productId");

-- Active-reservation lookups by SKU for warehouse diagnostics (INV-06).
CREATE INDEX "InventoryReservation_productId_status_idx"
ON "InventoryReservation"("productId", "status");

CREATE TABLE "InventoryLedger" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "type" "InventoryLedgerType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "onHandDelta" INTEGER NOT NULL,
    "reservedDelta" INTEGER NOT NULL,
    "onHandAfter" INTEGER NOT NULL,
    "reservedAfter" INTEGER NOT NULL,
    "referenceType" "InventoryLedgerReferenceType" NOT NULL,
    "referenceId" UUID,
    "reason" VARCHAR(500),
    "actorType" "InventoryLedgerActorType" NOT NULL,
    "actorId" UUID,
    "correlationId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLedger_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InventoryLedger"
ADD CONSTRAINT "InventoryLedger_quantity_positive_check"
CHECK ("quantity" > 0);

ALTER TABLE "InventoryLedger"
ADD CONSTRAINT "InventoryLedger_onHandAfter_non_negative_check"
CHECK ("onHandAfter" >= 0);

ALTER TABLE "InventoryLedger"
ADD CONSTRAINT "InventoryLedger_reservedAfter_non_negative_check"
CHECK ("reservedAfter" >= 0);

ALTER TABLE "InventoryLedger"
ADD CONSTRAINT "InventoryLedger_reservedAfter_lte_onHandAfter_check"
CHECK ("reservedAfter" <= "onHandAfter");

-- Quantity is magnitude; each non-zero delta must match that magnitude.
ALTER TABLE "InventoryLedger"
ADD CONSTRAINT "InventoryLedger_delta_magnitude_check"
CHECK (
    ("onHandDelta" = 0 OR abs("onHandDelta") = "quantity")
    AND ("reservedDelta" = 0 OR abs("reservedDelta") = "quantity")
);

ALTER TABLE "InventoryLedger"
ADD CONSTRAINT "InventoryLedger_actor_check"
CHECK (
    ("actorType" = 'SYSTEM' AND "actorId" IS NULL)
    OR ("actorType" IN ('USER', 'ADMIN') AND "actorId" IS NOT NULL)
);

ALTER TABLE "InventoryLedger"
ADD CONSTRAINT "InventoryLedger_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "InventoryLedger_productId_createdAt_idx"
ON "InventoryLedger"("productId", "createdAt");

-- One RESERVE, one RELEASE, and one SHIP per order/product. Manual RECEIVE/ADJUST
-- rows are intentionally excluded so operators may share a reference across
-- multiple legitimate stock events. Prisma cannot express this partial unique.
CREATE UNIQUE INDEX "InventoryLedger_order_event_unique"
ON "InventoryLedger" ("type", "referenceType", "referenceId", "productId")
WHERE "type" IN ('RESERVE', 'RELEASE', 'SHIP')
  AND "referenceType" = 'ORDER'
  AND "referenceId" IS NOT NULL;

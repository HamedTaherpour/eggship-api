-- PRC-01: Append-only Product price history with integer Toman constraints.
-- Additive only: one new table, enum, indexes, and Product relation. No existing
-- columns altered. Product deletion remains blocked while history rows exist
-- (ON DELETE RESTRICT). Rollback while unused: DROP TABLE "PriceHistory";
-- DROP TYPE "PriceHistoryActorType";

CREATE TYPE "PriceHistoryActorType" AS ENUM ('ADMIN');

CREATE TABLE "PriceHistory" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "oldPrice" INTEGER NOT NULL,
    "newPrice" INTEGER NOT NULL,
    "actorType" "PriceHistoryActorType" NOT NULL,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

-- Integer Toman only; both prices strictly positive and must differ (no no-op rows).
ALTER TABLE "PriceHistory"
ADD CONSTRAINT "PriceHistory_oldPrice_positive_check"
CHECK ("oldPrice" > 0);

ALTER TABLE "PriceHistory"
ADD CONSTRAINT "PriceHistory_newPrice_positive_check"
CHECK ("newPrice" > 0);

ALTER TABLE "PriceHistory"
ADD CONSTRAINT "PriceHistory_prices_differ_check"
CHECK ("oldPrice" <> "newPrice");

ALTER TABLE "PriceHistory"
ADD CONSTRAINT "PriceHistory_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "PriceHistory_productId_createdAt_idx" ON "PriceHistory"("productId", "createdAt");

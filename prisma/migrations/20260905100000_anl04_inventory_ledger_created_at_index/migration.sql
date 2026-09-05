-- ANL-04: support global recent-range InventoryLedger analytics.
-- Prisma migrate deploy applies this migration without wrapping the SQL in a
-- transaction, so PostgreSQL's CREATE INDEX CONCURRENTLY is valid here.
CREATE INDEX CONCURRENTLY "InventoryLedger_createdAt_idx"
ON "InventoryLedger" ("createdAt");

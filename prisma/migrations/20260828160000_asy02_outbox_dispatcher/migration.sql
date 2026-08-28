-- ASY-02: durable leases let dispatchers release PostgreSQL locks before Redis I/O.
ALTER TYPE "OutboxEventState" ADD VALUE 'CLAIMED';

ALTER TABLE "OutboxEvent"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "claimToken" UUID,
  ADD COLUMN "claimedAt" TIMESTAMPTZ(3),
  ADD COLUMN "leaseExpiresAt" TIMESTAMPTZ(3);

ALTER TABLE "OutboxEvent"
  DROP CONSTRAINT "OutboxEvent_publication_check",
  ADD CONSTRAINT "OutboxEvent_publication_check" CHECK (
    ("state" IN ('PENDING', 'CLAIMED') AND "publishedAt" IS NULL)
    OR ("state" = 'PUBLISHED' AND "publishedAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "OutboxEvent_claim_check" CHECK (
    ("state" = 'CLAIMED' AND "claimToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
    OR ("state" <> 'CLAIMED' AND "claimToken" IS NULL AND "leaseExpiresAt" IS NULL)
  ),
  ADD CONSTRAINT "OutboxEvent_attemptCount_check" CHECK ("attemptCount" >= 0);

DROP INDEX "OutboxEvent_state_createdAt_id_idx";
CREATE INDEX "OutboxEvent_state_nextAttemptAt_createdAt_id_idx"
  ON "OutboxEvent"("state", "nextAttemptAt", "createdAt", "id");

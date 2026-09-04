-- NOT-05 additive delivery execution state. Existing rows remain PENDING.
ALTER TABLE "Notification"
  ADD COLUMN "pushDeliveriesMaterializedAt" TIMESTAMPTZ(3);

ALTER TABLE "NotificationDelivery"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "claimToken" UUID,
  ADD COLUMN "claimedAt" TIMESTAMPTZ(3),
  ADD COLUMN "leaseExpiresAt" TIMESTAMPTZ(3);

ALTER TYPE "NotificationDeliveryFailureCode" ADD VALUE IF NOT EXISTS 'UNKNOWN';

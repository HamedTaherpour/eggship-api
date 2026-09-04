-- ASY-04 follow-up: durable replay claim/lease and processor receipt fields.
ALTER TYPE "AsyncReplayStatus" ADD VALUE 'CLAIMED';
ALTER TYPE "AsyncReplayStatus" ADD VALUE 'RUNNING';

ALTER TABLE "AsyncReplay"
  ADD COLUMN "claimToken" UUID,
  ADD COLUMN "resultCategory" "AsyncFailureCategory",
  ADD COLUMN "processorIdentity" VARCHAR(128),
  ADD COLUMN "releaseIdentity" VARCHAR(128);

ALTER TABLE "AsyncReplay"
  ADD CONSTRAINT "AsyncReplay_attemptCount_check" CHECK ("attemptCount" >= 0),
  ADD CONSTRAINT "AsyncReplay_reasonCode_check" CHECK (
    "failureReasonCode" IS NULL OR "failureReasonCode" ~ '^[a-z][a-z0-9_.-]{0,63}$'
  ),
  ADD CONSTRAINT "AsyncReplay_state_fields_check" CHECK (
    ("status" = 'CLAIMED' AND "claimToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
    OR ("status" <> 'CLAIMED' AND "claimToken" IS NULL)
  ),
  ADD CONSTRAINT "AsyncReplay_terminal_fields_check" CHECK (
    ("status" IN ('SUCCEEDED', 'FAILED') AND "completedAt" IS NOT NULL)
    OR ("status" NOT IN ('SUCCEEDED', 'FAILED'))
  );

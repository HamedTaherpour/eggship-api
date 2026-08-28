-- ASY-01: PostgreSQL-authoritative transactional outbox foundation.
CREATE TYPE "OutboxEventState" AS ENUM ('PENDING', 'PUBLISHED');

CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "eventType" VARCHAR(100) NOT NULL,
    "eventVersion" INTEGER NOT NULL,
    "correlationId" VARCHAR(128) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "state" "OutboxEventState" NOT NULL DEFAULT 'PENDING',
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OutboxEvent_eventType_check" CHECK ("eventType" ~ '^[a-z][a-z0-9._-]*$'),
    CONSTRAINT "OutboxEvent_eventVersion_check" CHECK ("eventVersion" > 0),
    CONSTRAINT "OutboxEvent_correlationId_check" CHECK ("correlationId" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
    CONSTRAINT "OutboxEvent_payload_check" CHECK (jsonb_typeof("payload") = 'object' AND octet_length("payload"::text) <= 65536),
    CONSTRAINT "OutboxEvent_publication_check" CHECK (
      ("state" = 'PENDING' AND "publishedAt" IS NULL)
      OR ("state" = 'PUBLISHED' AND "publishedAt" IS NOT NULL)
    )
);

CREATE INDEX "OutboxEvent_state_createdAt_id_idx"
  ON "OutboxEvent"("state", "createdAt", "id");
CREATE INDEX "OutboxEvent_publishedAt_id_idx"
  ON "OutboxEvent"("publishedAt", "id");

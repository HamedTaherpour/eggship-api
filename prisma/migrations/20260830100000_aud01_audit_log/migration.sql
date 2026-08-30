CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" VARCHAR(16) NOT NULL,
    "actorId" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entityType" VARCHAR(32) NOT NULL,
    "entityId" UUID,
    "requestId" VARCHAR(128),
    "correlationId" VARCHAR(128),
    "metadata" JSONB,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_occurredAt_id_idx" ON "AuditLog"("occurredAt", "id");
CREATE INDEX "AuditLog_actorType_actorId_occurredAt_id_idx" ON "AuditLog"("actorType", "actorId", "occurredAt", "id");
CREATE INDEX "AuditLog_entityType_entityId_occurredAt_id_idx" ON "AuditLog"("entityType", "entityId", "occurredAt", "id");
CREATE INDEX "AuditLog_action_occurredAt_id_idx" ON "AuditLog"("action", "occurredAt", "id");
CREATE INDEX "AuditLog_requestId_occurredAt_id_idx" ON "AuditLog"("requestId", "occurredAt", "id");
CREATE INDEX "AuditLog_correlationId_occurredAt_id_idx" ON "AuditLog"("correlationId", "occurredAt", "id");

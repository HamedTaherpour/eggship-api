-- COM-02: additive typed commerce-policy singleton and date overrides.
-- No defaults or seed rows are created: absent settings remain fail-closed.
-- Human review is required before shared-environment deployment.

CREATE TYPE "CommerceScheduleOverrideMode" AS ENUM ('CLOSED', 'SPECIAL_HOURS');

CREATE TABLE "CommerceSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "orderingScheduleEnabled" BOOLEAN NOT NULL,
    "orderingOpensAtLocalMinute" INTEGER NOT NULL,
    "orderingClosesAtLocalMinute" INTEGER NOT NULL,
    "minimumOrderQuantity" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdByAdminId" UUID NOT NULL,
    "updatedByAdminId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "CommerceSettings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CommerceSettings" ADD CONSTRAINT "CommerceSettings_singleton_check" CHECK ("id" = 1);
ALTER TABLE "CommerceSettings" ADD CONSTRAINT "CommerceSettings_open_minute_check" CHECK ("orderingOpensAtLocalMinute" BETWEEN 0 AND 1439);
ALTER TABLE "CommerceSettings" ADD CONSTRAINT "CommerceSettings_close_minute_check" CHECK ("orderingClosesAtLocalMinute" BETWEEN 0 AND 1439);
ALTER TABLE "CommerceSettings" ADD CONSTRAINT "CommerceSettings_window_check" CHECK ("orderingOpensAtLocalMinute" <> "orderingClosesAtLocalMinute");
ALTER TABLE "CommerceSettings" ADD CONSTRAINT "CommerceSettings_minimum_quantity_check" CHECK ("minimumOrderQuantity" BETWEEN 1 AND 2147483647);
ALTER TABLE "CommerceSettings" ADD CONSTRAINT "CommerceSettings_revision_check" CHECK ("revision" >= 1);

CREATE TABLE "CommerceScheduleOverride" (
    "id" UUID NOT NULL,
    "localDate" DATE NOT NULL,
    "mode" "CommerceScheduleOverrideMode" NOT NULL,
    "opensAtLocalMinute" INTEGER,
    "closesAtLocalMinute" INTEGER,
    "createdByAdminId" UUID NOT NULL,
    "updatedByAdminId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "CommerceScheduleOverride_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CommerceScheduleOverride" ADD CONSTRAINT "CommerceScheduleOverride_shape_check" CHECK (
  ("mode" = 'CLOSED' AND "opensAtLocalMinute" IS NULL AND "closesAtLocalMinute" IS NULL)
  OR
  ("mode" = 'SPECIAL_HOURS'
    AND "opensAtLocalMinute" BETWEEN 0 AND 1439
    AND "closesAtLocalMinute" BETWEEN 0 AND 1439
    AND "opensAtLocalMinute" <> "closesAtLocalMinute")
);

CREATE UNIQUE INDEX "CommerceScheduleOverride_localDate_key" ON "CommerceScheduleOverride"("localDate");
CREATE INDEX "CommerceScheduleOverride_localDate_idx" ON "CommerceScheduleOverride"("localDate");

ALTER TABLE "CommerceSettings" ADD CONSTRAINT "CommerceSettings_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommerceSettings" ADD CONSTRAINT "CommerceSettings_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommerceScheduleOverride" ADD CONSTRAINT "CommerceScheduleOverride_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommerceScheduleOverride" ADD CONSTRAINT "CommerceScheduleOverride_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

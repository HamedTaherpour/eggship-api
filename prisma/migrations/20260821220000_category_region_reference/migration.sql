-- CAT-02: Category and Region reference tables.
-- Additive only: two new tables and indexes. No existing objects altered.
-- No uniqueness on name (MIG-01 evidence pending). Prefer deactivation over
-- hard delete; future Product/profile FKs should use ON DELETE RESTRICT.
-- Rollback while unused: DROP TABLE "Category"; DROP TABLE "Region";

CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- Trimmed, non-empty display label. Application also trims on write.
ALTER TABLE "Category"
ADD CONSTRAINT "Category_name_trimmed_check"
CHECK (
    "name" = btrim("name")
    AND char_length("name") BETWEEN 1 AND 100
);

CREATE INDEX "Category_isActive_name_idx" ON "Category"("isActive", "name");

CREATE TABLE "Region" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Region"
ADD CONSTRAINT "Region_name_trimmed_check"
CHECK (
    "name" = btrim("name")
    AND char_length("name") BETWEEN 1 AND 100
);

CREATE INDEX "Region_isActive_name_idx" ON "Region"("isActive", "name");

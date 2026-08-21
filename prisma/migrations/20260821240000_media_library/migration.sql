-- CAT-04: reusable Media library metadata. Additive only: one new table.
-- No Product/Blog/Category FKs (attachment is later). No binary/bytea columns.
-- Rollback while unused: DROP TABLE "Media";

CREATE TABLE "Media" (
    "id" UUID NOT NULL,
    "storageKey" VARCHAR(255) NOT NULL,
    "originalFileName" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(64) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Media_storageKey_key" ON "Media"("storageKey");

CREATE INDEX "Media_createdAt_idx" ON "Media"("createdAt");

CREATE INDEX "Media_mimeType_createdAt_idx" ON "Media"("mimeType", "createdAt");

-- Server-generated object key: media/<year>/<month>/<uuid>.<jpg|png|webp>
ALTER TABLE "Media"
ADD CONSTRAINT "Media_storageKey_format_check"
CHECK (
    "storageKey" ~ '^media/[0-9]{4}/[0-9]{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
);

ALTER TABLE "Media"
ADD CONSTRAINT "Media_originalFileName_length_check"
CHECK (
    char_length("originalFileName") BETWEEN 1 AND 255
    AND position(CHR(0) IN "originalFileName") = 0
);

ALTER TABLE "Media"
ADD CONSTRAINT "Media_mimeType_check"
CHECK ("mimeType" IN ('image/jpeg', 'image/png', 'image/webp'));

-- Launch file cap is configurable up to 20 MiB; DB hard-stops above that.
ALTER TABLE "Media"
ADD CONSTRAINT "Media_sizeBytes_positive_check"
CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 20971520);

ALTER TABLE "Media"
ADD CONSTRAINT "Media_dimensions_check"
CHECK (
    ("width" IS NULL AND "height" IS NULL)
    OR (
        "width" IS NOT NULL
        AND "height" IS NOT NULL
        AND "width" > 0
        AND "height" > 0
    )
);

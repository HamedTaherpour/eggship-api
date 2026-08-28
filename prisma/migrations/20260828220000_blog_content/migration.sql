-- CNT-01: Blog persistence for public published list/detail.
-- Additive only: one new table, unique slug, publication CHECKs, and the
-- public list index. No existing columns or tables altered. No Media FK
-- (MED-01). No author/tags/SEO/scheduling fields (MIG-01).
-- Rollback while unused: DROP TABLE "Blog";

CREATE TABLE "Blog" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Blog_pkey" PRIMARY KEY ("id")
);

-- Canonical slug: trimmed lowercase kebab-case. Unique including drafts so
-- unpublished detail cannot collide with a later public slug.
ALTER TABLE "Blog"
ADD CONSTRAINT "Blog_slug_canonical_check"
CHECK (
    "slug" = btrim("slug")
    AND "slug" = lower("slug")
    AND char_length("slug") BETWEEN 1 AND 120
    AND "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
);

ALTER TABLE "Blog"
ADD CONSTRAINT "Blog_title_trimmed_check"
CHECK (
    "title" = btrim("title")
    AND char_length("title") BETWEEN 1 AND 200
);

ALTER TABLE "Blog"
ADD CONSTRAINT "Blog_body_length_check"
CHECK (char_length("body") BETWEEN 1 AND 100000);

-- Published rows must have a publication instant. Drafts may omit it.
-- Future publishedAt is not a visibility gate (no scheduling in CNT-01).
ALTER TABLE "Blog"
ADD CONSTRAINT "Blog_published_requires_publishedAt_check"
CHECK (("isPublished" = false) OR ("publishedAt" IS NOT NULL));

CREATE UNIQUE INDEX "Blog_slug_key" ON "Blog"("slug");

CREATE INDEX "Blog_isPublished_publishedAt_id_idx"
ON "Blog"("isPublished", "publishedAt", "id");

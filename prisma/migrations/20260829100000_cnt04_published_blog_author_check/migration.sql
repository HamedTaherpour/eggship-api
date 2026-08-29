-- CNT-04 remediation: new and updated published Blogs must always have an Author.
-- NOT VALID preserves pre-CNT-04 published legacy rows that have no author; PostgreSQL
-- still checks every INSERT/UPDATE, and MIG-01 owns any later historical backfill.
ALTER TABLE "Blog"
  ADD CONSTRAINT "Blog_published_author_check"
  CHECK (NOT "isPublished" OR "authorId" IS NOT NULL)
  NOT VALID;

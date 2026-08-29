-- CNT-04: additive Blog content model expansion. No MED-01 Media columns.
ALTER TABLE "Blog" ADD COLUMN "excerpt" VARCHAR(320), ADD COLUMN "seoTitle" VARCHAR(200), ADD COLUMN "seoDescription" VARCHAR(320), ADD COLUMN "authorId" UUID;

CREATE TABLE "BlogAuthor" (
  "id" UUID NOT NULL, "name" VARCHAR(160) NOT NULL, "slug" VARCHAR(120) NOT NULL,
  "bio" VARCHAR(2000), "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "BlogAuthor_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BlogCategory" (
  "id" UUID NOT NULL, "name" VARCHAR(100) NOT NULL, "slug" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500), "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "BlogCategory_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BlogTag" (
  "id" UUID NOT NULL, "name" VARCHAR(100) NOT NULL, "slug" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "BlogTag_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BlogCategoryOnBlog" (
  "blogId" UUID NOT NULL, "categoryId" UUID NOT NULL,
  CONSTRAINT "BlogCategoryOnBlog_pkey" PRIMARY KEY ("blogId", "categoryId")
);
CREATE TABLE "BlogTagOnBlog" (
  "blogId" UUID NOT NULL, "tagId" UUID NOT NULL,
  CONSTRAINT "BlogTagOnBlog_pkey" PRIMARY KEY ("blogId", "tagId")
);

ALTER TABLE "Blog" ADD CONSTRAINT "Blog_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "BlogAuthor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogCategoryOnBlog" ADD CONSTRAINT "BlogCategoryOnBlog_blogId_fkey" FOREIGN KEY ("blogId") REFERENCES "Blog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogCategoryOnBlog" ADD CONSTRAINT "BlogCategoryOnBlog_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BlogCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogTagOnBlog" ADD CONSTRAINT "BlogTagOnBlog_blogId_fkey" FOREIGN KEY ("blogId") REFERENCES "Blog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogTagOnBlog" ADD CONSTRAINT "BlogTagOnBlog_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "BlogTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "BlogAuthor_slug_key" ON "BlogAuthor"("slug");
CREATE UNIQUE INDEX "BlogCategory_slug_key" ON "BlogCategory"("slug");
CREATE UNIQUE INDEX "BlogTag_slug_key" ON "BlogTag"("slug");
CREATE INDEX "Blog_authorId_idx" ON "Blog"("authorId");
CREATE INDEX "BlogAuthor_isActive_name_id_idx" ON "BlogAuthor"("isActive", "name", "id");
CREATE INDEX "BlogCategory_isActive_name_id_idx" ON "BlogCategory"("isActive", "name", "id");
CREATE INDEX "BlogTag_name_id_idx" ON "BlogTag"("name", "id");
CREATE INDEX "BlogCategoryOnBlog_categoryId_blogId_idx" ON "BlogCategoryOnBlog"("categoryId", "blogId");
CREATE INDEX "BlogTagOnBlog_tagId_blogId_idx" ON "BlogTagOnBlog"("tagId", "blogId");

ALTER TABLE "Blog" ADD CONSTRAINT "Blog_excerpt_length_check" CHECK ("excerpt" IS NULL OR (char_length("excerpt") BETWEEN 1 AND 320));
ALTER TABLE "Blog" ADD CONSTRAINT "Blog_seoTitle_length_check" CHECK ("seoTitle" IS NULL OR (char_length("seoTitle") BETWEEN 1 AND 200));
ALTER TABLE "Blog" ADD CONSTRAINT "Blog_seoDescription_length_check" CHECK ("seoDescription" IS NULL OR (char_length("seoDescription") BETWEEN 1 AND 320));
ALTER TABLE "BlogAuthor" ADD CONSTRAINT "BlogAuthor_slug_check" CHECK ("slug" = btrim("slug") AND "slug" = lower("slug") AND "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") BETWEEN 1 AND 120);
ALTER TABLE "BlogCategory" ADD CONSTRAINT "BlogCategory_slug_check" CHECK ("slug" = btrim("slug") AND "slug" = lower("slug") AND "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") BETWEEN 1 AND 120);
ALTER TABLE "BlogTag" ADD CONSTRAINT "BlogTag_slug_check" CHECK ("slug" = btrim("slug") AND "slug" = lower("slug") AND "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") BETWEEN 1 AND 120);

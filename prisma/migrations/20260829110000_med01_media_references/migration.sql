ALTER TABLE "Product" ADD COLUMN "imageMediaId" UUID;
ALTER TABLE "Blog" ADD COLUMN "coverMediaId" UUID;
ALTER TABLE "BlogAuthor" ADD COLUMN "avatarMediaId" UUID;

CREATE TABLE "BlogInlineMedia" (
    "blogId" UUID NOT NULL,
    "mediaId" UUID NOT NULL,
    CONSTRAINT "BlogInlineMedia_pkey" PRIMARY KEY ("blogId", "mediaId")
);

CREATE INDEX "Product_imageMediaId_idx" ON "Product"("imageMediaId");
CREATE INDEX "Blog_coverMediaId_idx" ON "Blog"("coverMediaId");
CREATE INDEX "BlogAuthor_avatarMediaId_idx" ON "BlogAuthor"("avatarMediaId");
CREATE INDEX "BlogInlineMedia_mediaId_blogId_idx" ON "BlogInlineMedia"("mediaId", "blogId");

ALTER TABLE "Product" ADD CONSTRAINT "Product_imageMediaId_fkey"
  FOREIGN KEY ("imageMediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Blog" ADD CONSTRAINT "Blog_coverMediaId_fkey"
  FOREIGN KEY ("coverMediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogAuthor" ADD CONSTRAINT "BlogAuthor_avatarMediaId_fkey"
  FOREIGN KEY ("avatarMediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogInlineMedia" ADD CONSTRAINT "BlogInlineMedia_blogId_fkey"
  FOREIGN KEY ("blogId") REFERENCES "Blog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlogInlineMedia" ADD CONSTRAINT "BlogInlineMedia_mediaId_fkey"
  FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

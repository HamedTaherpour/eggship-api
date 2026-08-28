-- CNT-01 review follow-up: align Blog text CHECKs with application invariants.
-- Application trimming uses ECMAScript String.trim() (all Unicode whitespace).
-- Database guards trim only ASCII space, tab, LF, and CR, and use char_length
-- for bounds. Repository writes normalize through domain helpers first.

ALTER TABLE "Blog" DROP CONSTRAINT IF EXISTS "Blog_slug_canonical_check";
ALTER TABLE "Blog" DROP CONSTRAINT IF EXISTS "Blog_title_trimmed_check";
ALTER TABLE "Blog" DROP CONSTRAINT IF EXISTS "Blog_body_length_check";

ALTER TABLE "Blog"
ADD CONSTRAINT "Blog_slug_canonical_check"
CHECK (
    "slug" = regexp_replace("slug", '^[ \t\n\r]+|[ \t\n\r]+$', '', 'g')
    AND "slug" = lower("slug")
    AND char_length("slug") BETWEEN 1 AND 120
    AND "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
);

ALTER TABLE "Blog"
ADD CONSTRAINT "Blog_title_trimmed_check"
CHECK (
    "title" = regexp_replace("title", '^[ \t\n\r]+|[ \t\n\r]+$', '', 'g')
    AND char_length("title") BETWEEN 1 AND 200
);

ALTER TABLE "Blog"
ADD CONSTRAINT "Blog_body_length_check"
CHECK (
    "body" = regexp_replace("body", '^[ \t\n\r]+|[ \t\n\r]+$', '', 'g')
    AND char_length("body") BETWEEN 1 AND 100000
);

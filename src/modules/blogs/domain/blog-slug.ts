import { BlogInvalidSlugError } from './blog-errors';

/** Maximum stored length for Blog.slug (matches Prisma VarChar(120)). */
export const BLOG_SLUG_MAX_LENGTH = 120;

/**
 * Canonical persisted slug: trimmed lowercase kebab-case.
 * Single segment (`eggs`) and hyphenated (`cage-free-eggs`) are valid.
 */
export const BLOG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Canonicalize a caller-provided slug for persistence and public lookup.
 * Case-folds and trims only — does not generate slugs from titles or rewrite
 * spaces/punctuation into hyphens.
 */
export function normalizeBlogSlug(raw: string): string {
  if (typeof raw !== 'string') {
    throw new BlogInvalidSlugError('Blog slug must be a string.');
  }

  const slug = raw.trim().toLowerCase();
  if (slug.length < 1 || slug.length > BLOG_SLUG_MAX_LENGTH) {
    throw new BlogInvalidSlugError(
      `Blog slug must be between 1 and ${BLOG_SLUG_MAX_LENGTH} characters after trimming.`,
    );
  }

  if (!BLOG_SLUG_PATTERN.test(slug)) {
    throw new BlogInvalidSlugError(
      'Blog slug must be lowercase kebab-case (letters, digits, and single hyphens).',
    );
  }

  return slug;
}

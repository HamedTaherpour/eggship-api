import { BlogInvalidBodyError } from './blog-errors';
import { blogTextCharLength } from './blog-text';

/**
 * Maximum stored length for Blog.body (matches the SQL CHECK).
 * Abuse bound, not a legacy-derived editorial limit.
 */
export const BLOG_BODY_MAX_LENGTH = 100_000;

/**
 * Canonicalize a blog body for persistence.
 * Trims surrounding whitespace; preserves internal whitespace and markup.
 * Does not sanitize HTML/Markdown — rendering/XSS belongs to the frontend.
 */
export function normalizeBlogBody(raw: string): string {
  if (typeof raw !== 'string') {
    throw new BlogInvalidBodyError('Blog body must be a string.');
  }

  const body = raw.trim();
  const length = blogTextCharLength(body);
  if (length < 1 || length > BLOG_BODY_MAX_LENGTH) {
    throw new BlogInvalidBodyError(
      `Blog body must be between 1 and ${BLOG_BODY_MAX_LENGTH} characters after trimming.`,
    );
  }

  return body;
}

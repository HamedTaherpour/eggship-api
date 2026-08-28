import { BlogInvalidTitleError } from './blog-errors';
import { blogTextCharLength } from './blog-text';

/** Maximum stored length for Blog.title (matches Prisma VarChar(200)). */
export const BLOG_TITLE_MAX_LENGTH = 200;

/**
 * Canonicalize a blog title for persistence.
 * Trim only - do not invent case-folding or Unicode normalization beyond trim.
 */
export function normalizeBlogTitle(raw: string): string {
  if (typeof raw !== 'string') {
    throw new BlogInvalidTitleError('Blog title must be a string.');
  }

  const title = raw.trim();
  const length = blogTextCharLength(title);
  if (length < 1 || length > BLOG_TITLE_MAX_LENGTH) {
    throw new BlogInvalidTitleError(
      `Blog title must be between 1 and ${BLOG_TITLE_MAX_LENGTH} characters after trimming.`,
    );
  }

  return title;
}

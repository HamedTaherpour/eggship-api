import { BlogInvalidFieldError } from './blog-errors';
import { blogTextCharLength } from './blog-text';

export const BLOG_EXCERPT_MAX_LENGTH = 320;
export const BLOG_SEO_TITLE_MAX_LENGTH = 200;
export const BLOG_SEO_DESCRIPTION_MAX_LENGTH = 320;
export const BLOG_DESCRIPTION_MAX_LENGTH = 500;
export const BLOG_AUTHOR_NAME_MAX_LENGTH = 160;
export const BLOG_AUTHOR_BIO_MAX_LENGTH = 2000;
// PostgreSQL stores Blog taxonomy names as VARCHAR(100); keep both contracts aligned.
export const BLOG_TAXONOMY_NAME_MAX_LENGTH = 100;

export function normalizeOptionalBlogText(
  raw: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw new BlogInvalidFieldError(field);
  const value = raw.trim();
  if (value.length === 0) return null;
  if (blogTextCharLength(value) > maxLength) {
    throw new BlogInvalidFieldError(
      `${field} must be at most ${maxLength} characters.`,
    );
  }
  return value;
}

export function normalizeRequiredBlogText(
  raw: unknown,
  field: string,
  maxLength: number,
): string {
  const value = normalizeOptionalBlogText(raw, field, maxLength);
  if (value === null) throw new BlogInvalidFieldError(`${field} is required.`);
  return value;
}

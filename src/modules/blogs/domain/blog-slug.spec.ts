import { normalizeBlogSlug, BLOG_SLUG_MAX_LENGTH } from './blog-slug';
import { BlogInvalidSlugError } from './blog-errors';

describe('normalizeBlogSlug', () => {
  it('trims, lowercases, and accepts kebab-case', () => {
    expect(normalizeBlogSlug('  Cage-Free-Eggs  ')).toBe('cage-free-eggs');
    expect(normalizeBlogSlug('eggs')).toBe('eggs');
  });

  it('rejects empty, spaced, underscored, or punctuated values', () => {
    expect(() => normalizeBlogSlug('   ')).toThrow(BlogInvalidSlugError);
    expect(() => normalizeBlogSlug('cage free')).toThrow(BlogInvalidSlugError);
    expect(() => normalizeBlogSlug('cage_free')).toThrow(BlogInvalidSlugError);
    expect(() => normalizeBlogSlug('-eggs')).toThrow(BlogInvalidSlugError);
    expect(() => normalizeBlogSlug('eggs-')).toThrow(BlogInvalidSlugError);
    expect(() => normalizeBlogSlug('eggs--pack')).toThrow(BlogInvalidSlugError);
  });

  it('rejects slugs longer than the persisted maximum', () => {
    expect(() =>
      normalizeBlogSlug(`${'a'.repeat(BLOG_SLUG_MAX_LENGTH + 1)}`),
    ).toThrow(BlogInvalidSlugError);
  });
});

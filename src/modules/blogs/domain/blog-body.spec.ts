import { normalizeBlogBody, BLOG_BODY_MAX_LENGTH } from './blog-body';
import { BlogInvalidBodyError } from './blog-errors';

describe('normalizeBlogBody', () => {
  it('trims surrounding whitespace and preserves internal markup', () => {
    expect(normalizeBlogBody('  <p>Eggs</p>\n<p>Pack cool.</p>  ')).toBe(
      '<p>Eggs</p>\n<p>Pack cool.</p>',
    );
  });

  it('rejects empty or whitespace-only bodies', () => {
    expect(() => normalizeBlogBody('   ')).toThrow(BlogInvalidBodyError);
  });

  it('rejects bodies over the abuse bound', () => {
    expect(() =>
      normalizeBlogBody('x'.repeat(BLOG_BODY_MAX_LENGTH + 1)),
    ).toThrow(BlogInvalidBodyError);
  });
});

import { normalizeBlogTitle, BLOG_TITLE_MAX_LENGTH } from './blog-title';
import { BlogInvalidTitleError } from './blog-errors';

describe('normalizeBlogTitle', () => {
  it('trims and accepts a valid title', () => {
    expect(normalizeBlogTitle('  Packing eggs  ')).toBe('Packing eggs');
  });

  it('rejects empty or whitespace-only titles', () => {
    expect(() => normalizeBlogTitle('   ')).toThrow(BlogInvalidTitleError);
  });

  it('rejects titles longer than 200 characters', () => {
    expect(() =>
      normalizeBlogTitle('x'.repeat(BLOG_TITLE_MAX_LENGTH + 1)),
    ).toThrow(BlogInvalidTitleError);
  });
});

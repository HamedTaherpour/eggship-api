import { normalizeBlogTitle, BLOG_TITLE_MAX_LENGTH } from './blog-title';
import { BlogInvalidTitleError } from './blog-errors';

describe('normalizeBlogTitle', () => {
  it('trims and accepts a valid title', () => {
    expect(normalizeBlogTitle('  Packing eggs  ')).toBe('Packing eggs');
  });

  it('rejects empty or whitespace-only titles', () => {
    expect(() => normalizeBlogTitle('   ')).toThrow(BlogInvalidTitleError);
    expect(() => normalizeBlogTitle('\t\n\r')).toThrow(BlogInvalidTitleError);
  });

  it('rejects titles longer than 200 characters', () => {
    expect(() =>
      normalizeBlogTitle('x'.repeat(BLOG_TITLE_MAX_LENGTH + 1)),
    ).toThrow(BlogInvalidTitleError);
  });

  it('counts Persian characters like PostgreSQL char_length', () => {
    const persian = 'آ';
    expect(normalizeBlogTitle(persian.repeat(BLOG_TITLE_MAX_LENGTH))).toBe(
      persian.repeat(BLOG_TITLE_MAX_LENGTH),
    );
    expect(() =>
      normalizeBlogTitle(persian.repeat(BLOG_TITLE_MAX_LENGTH + 1)),
    ).toThrow(BlogInvalidTitleError);
  });

  it('counts emoji code points like PostgreSQL char_length', () => {
    const emoji = '😀';
    expect(normalizeBlogTitle(emoji.repeat(BLOG_TITLE_MAX_LENGTH))).toBe(
      emoji.repeat(BLOG_TITLE_MAX_LENGTH),
    );
    expect(() =>
      normalizeBlogTitle(emoji.repeat(BLOG_TITLE_MAX_LENGTH + 1)),
    ).toThrow(BlogInvalidTitleError);
  });
});

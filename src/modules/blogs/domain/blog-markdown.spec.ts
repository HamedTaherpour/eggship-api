import { parseBlogDirective, validateBlogMarkdown } from './blog-markdown';
import { BlogInvalidBodyError } from './blog-errors';

describe('Blog Markdown profile', () => {
  it('accepts Markdown and controlled directives without rendering it', () => {
    const source =
      '# Eggs\n\n[shop](https://eggship.example)\n\n::aparat[id="ivejp35"]';
    expect(validateBlogMarkdown(source)).toBe(source);
    expect(parseBlogDirective('::aparat[id="ivejp35"]')).toEqual({
      name: 'aparat',
      id: 'ivejp35',
    });
  });
  it.each([
    '<script>alert(1)</script>',
    '<iframe src="https://evil.example"></iframe>',
    '<img src=x onerror=alert(1)>',
    '[x](javascript:alert(1))',
    '![x](https://tracker.example/x.gif)',
  ])('rejects executable or unsafe content: %s', (source) => {
    expect(() => validateBlogMarkdown(source)).toThrow(BlogInvalidBodyError);
  });
  it.each([
    '::unknown[id="x"]',
    '::aparat[id="x",id="y"]',
    '::aparat[id="a b"]',
    '::media[id="not-a-uuid"]',
  ])('rejects malformed or unsafe directives: %s', (source) => {
    expect(() => validateBlogMarkdown(source)).toThrow(BlogInvalidBodyError);
  });
  it('accepts legal whitespace between directive attributes and unescapes quotes', () => {
    expect(
      parseBlogDirective(
        '::media[id="123e4567-e89b-42d3-a456-426614174000" alt = "egg \\"crate\\"" caption="Cool\tcrate"]',
      ),
    ).toEqual({
      name: 'media',
      id: '123e4567-e89b-42d3-a456-426614174000',
      alt: 'egg "crate"',
      caption: 'Cool\tcrate',
    });
  });
  it.each([
    '::media[id="123e4567-e89b-42d3-a456-426614174000"alt="x"]',
    '::media[id="123e4567-e89b-42d3-a456-426614174000" foo="x"]',
    '::media[alt="x"]',
    '::media[id="123e4567-e89b-42d3-a456-426614174000" id="x"]',
    '::media[id="123e4567-e89b-42d3-a456-426614174000"] trailing',
  ])('rejects invalid directive grammar: %s', (source) => {
    expect(() => parseBlogDirective(source)).toThrow(BlogInvalidBodyError);
  });
});

import {
  isBlogPubliclyVisible,
  publishedBlogWhere,
  resolveBlogPublication,
} from './blog-publication';

describe('blog publication eligibility', () => {
  it('treats only isPublished as public eligibility', () => {
    expect(isBlogPubliclyVisible({ isPublished: true })).toBe(true);
    expect(isBlogPubliclyVisible({ isPublished: false })).toBe(false);
    expect(
      isBlogPubliclyVisible({
        isPublished: true,
      }),
    ).toBe(true);
  });

  it('does not treat a future publishedAt as a schedule gate', () => {
    const future = new Date('2099-01-01T00:00:00.000Z');
    expect(
      isBlogPubliclyVisible({
        isPublished: true,
      }),
    ).toBe(true);
    const published = resolveBlogPublication({
      isPublished: true,
      publishedAt: future,
    });
    expect(published.publishedAt).toEqual(future);
    expect(isBlogPubliclyVisible(published)).toBe(true);
  });

  it('shares one published WHERE fragment for list, detail, and counts', () => {
    expect(publishedBlogWhere()).toEqual({ isPublished: true });
  });

  it('fills publishedAt when publishing without an explicit instant', () => {
    const now = new Date('2026-08-28T12:00:00.000Z');
    expect(resolveBlogPublication({ isPublished: true, now })).toEqual({
      isPublished: true,
      publishedAt: now,
    });
  });

  it('allows drafts to omit publishedAt', () => {
    expect(resolveBlogPublication({ isPublished: false })).toEqual({
      isPublished: false,
      publishedAt: null,
    });
  });
});

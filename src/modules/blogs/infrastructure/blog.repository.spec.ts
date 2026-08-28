import type { BlogListQuery } from '../domain/blog';
import { publishedBlogWhere } from '../domain/blog-publication';
import { buildBlogListWhereForTest } from './blog.repository';

describe('BlogRepository query mapping', () => {
  it('applies the shared published predicate and title-only search', () => {
    const query: BlogListQuery = {
      page: 1,
      pageSize: 20,
      search: 'egg',
      sortBy: 'publishedAt',
      sortOrder: 'desc',
      publishedOnly: true,
    };

    expect(buildBlogListWhereForTest(query)).toEqual({
      ...publishedBlogWhere(),
      title: { contains: 'egg', mode: 'insensitive' },
    });
  });

  it('does not search body and does not expose unpublished rows by default', () => {
    const query: BlogListQuery = {
      page: 1,
      pageSize: 20,
      sortBy: 'title',
      sortOrder: 'asc',
    };

    const where = buildBlogListWhereForTest(query);
    expect(where).toEqual({});
    expect(where).not.toHaveProperty('body');
    expect(where).not.toHaveProperty('isPublished');
  });
});

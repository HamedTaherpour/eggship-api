import type { BlogListQuery } from '../domain/blog';
import { publishedBlogWhere } from '../domain/blog-publication';
import {
  buildAdminBlogListWhereForTest,
  buildPublishedBlogListWhereForTest,
} from './blog.repository';

describe('BlogRepository query mapping', () => {
  it('always applies the shared published predicate and title-only search', () => {
    const query: BlogListQuery = {
      page: 1,
      pageSize: 20,
      search: 'egg',
      sortBy: 'publishedAt',
      sortOrder: 'desc',
    };

    expect(buildPublishedBlogListWhereForTest(query)).toEqual({
      ...publishedBlogWhere(),
      title: { contains: 'egg', mode: 'insensitive' },
    });
  });

  it('does not search body through the published list mapper', () => {
    const query: BlogListQuery = {
      page: 1,
      pageSize: 20,
      sortBy: 'title',
      sortOrder: 'asc',
    };

    const where = buildPublishedBlogListWhereForTest(query);
    expect(where).toEqual(publishedBlogWhere());
    expect(where).not.toHaveProperty('body');
  });

  it('admin listAll mapper does not apply published predicate and supports isPublished filter', () => {
    const query: BlogListQuery = {
      page: 1,
      pageSize: 20,
      sortBy: 'createdAt',
      sortOrder: 'asc',
      isPublished: false,
    };

    expect(buildAdminBlogListWhereForTest(query)).toEqual({
      isPublished: false,
    });
    expect(buildAdminBlogListWhereForTest(query)).not.toEqual(
      publishedBlogWhere(),
    );
  });
});

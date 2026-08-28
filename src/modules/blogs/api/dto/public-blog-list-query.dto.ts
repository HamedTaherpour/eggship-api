import { IntersectionType } from '@nestjs/swagger';
import {
  createSortQueryDto,
  PaginationQueryDto,
  SearchQueryDto,
} from '../../../../common/list';

export const PUBLIC_BLOG_SORT_FIELDS = [
  'publishedAt',
  'title',
  'createdAt',
] as const;

const publicBlogSort = createSortQueryDto({
  fields: PUBLIC_BLOG_SORT_FIELDS,
  defaultSortBy: 'publishedAt',
  defaultSortOrder: 'desc',
});

export const resolvePublicBlogSort = publicBlogSort.resolveSort;

/**
 * Public Blog list query: pagination + search (title only) + sort allowlist.
 * Drafts are never exposed; `isPublished` is not a public filter.
 */
export class PublicBlogListQueryDto extends IntersectionType(
  PaginationQueryDto,
  SearchQueryDto,
  publicBlogSort.SortQueryDto,
) {}

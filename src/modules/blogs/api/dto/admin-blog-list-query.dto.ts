import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import {
  createSortQueryDto,
  PaginationQueryDto,
  parseQueryBoolean,
  SearchQueryDto,
} from '../../../../common/list';

export const ADMIN_BLOG_SORT_FIELDS = [
  'publishedAt',
  'title',
  'createdAt',
] as const;

const adminBlogSort = createSortQueryDto({
  fields: ADMIN_BLOG_SORT_FIELDS,
  defaultSortBy: 'publishedAt',
  defaultSortOrder: 'desc',
});

export const resolveAdminBlogSort = adminBlogSort.resolveSort;

class BlogIsPublishedFilterDto {
  @ApiPropertyOptional({
    description:
      'When set, restrict to published (`true`) or draft/unpublished (`false`) rows. Accepts only `true` / `false`.',
    type: Boolean,
    example: false,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseQueryBoolean(value))
  @IsBoolean()
  isPublished?: boolean;
}

/**
 * Admin Blog list query: pagination + search (title) + sort allowlist + isPublished.
 */
export class AdminBlogListQueryDto extends IntersectionType(
  PaginationQueryDto,
  SearchQueryDto,
  adminBlogSort.SortQueryDto,
  BlogIsPublishedFilterDto,
) {}

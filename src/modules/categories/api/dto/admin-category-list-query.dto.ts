import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import {
  createSortQueryDto,
  PaginationQueryDto,
  parseQueryBoolean,
  SearchQueryDto,
} from '../../../../common/list';

export const CATEGORY_SORT_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;

const categorySort = createSortQueryDto({
  fields: CATEGORY_SORT_FIELDS,
  defaultSortBy: 'name',
  defaultSortOrder: 'asc',
});

export const resolveCategorySort = categorySort.resolveSort;

class CategoryIsActiveFilterDto {
  @ApiPropertyOptional({
    description:
      'When set, restrict to active (`true`) or inactive (`false`) categories. Accepts only `true` / `false`.',
    type: Boolean,
    example: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Admin Category list query: pagination + search (name) + sort allowlist + isActive.
 */
export class AdminCategoryListQueryDto extends IntersectionType(
  PaginationQueryDto,
  SearchQueryDto,
  categorySort.SortQueryDto,
  CategoryIsActiveFilterDto,
) {}

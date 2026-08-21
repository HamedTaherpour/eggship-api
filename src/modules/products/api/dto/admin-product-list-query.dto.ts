import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import {
  createSortQueryDto,
  PaginationQueryDto,
  parseQueryBoolean,
  SearchQueryDto,
} from '../../../../common/list';

export const ADMIN_PRODUCT_SORT_FIELDS = [
  'name',
  'price',
  'createdAt',
  'updatedAt',
] as const;

const adminProductSort = createSortQueryDto({
  fields: ADMIN_PRODUCT_SORT_FIELDS,
  defaultSortBy: 'createdAt',
  defaultSortOrder: 'desc',
});

export const resolveAdminProductSort = adminProductSort.resolveSort;

class AdminProductFiltersDto {
  @ApiPropertyOptional({
    description: 'When set, restrict to products in this Category (UUID).',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ApiPropertyOptional({
    description:
      'When set, restrict to active (`true`) or inactive (`false`) products. Accepts only `true` / `false`.',
    type: Boolean,
    example: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Admin Product list query: pagination + search (name) + sort allowlist +
 * categoryId + isActive.
 */
export class AdminProductListQueryDto extends IntersectionType(
  PaginationQueryDto,
  SearchQueryDto,
  adminProductSort.SortQueryDto,
  AdminProductFiltersDto,
) {}

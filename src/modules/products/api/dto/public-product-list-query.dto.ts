import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import {
  createSortQueryDto,
  PaginationQueryDto,
  SearchQueryDto,
} from '../../../../common/list';

export const PUBLIC_PRODUCT_SORT_FIELDS = [
  'name',
  'price',
  'createdAt',
  'updatedAt',
] as const;

const publicProductSort = createSortQueryDto({
  fields: PUBLIC_PRODUCT_SORT_FIELDS,
  defaultSortBy: 'name',
  defaultSortOrder: 'asc',
});

export const resolvePublicProductSort = publicProductSort.resolveSort;

class ProductCategoryIdFilterDto {
  @ApiPropertyOptional({
    description: 'When set, restrict to products in this Category (UUID).',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;
}

/**
 * Public Product list query: pagination + search (name) + sort + categoryId.
 * Inactive products are never exposed; `isActive` is not a public filter.
 */
export class PublicProductListQueryDto extends IntersectionType(
  PaginationQueryDto,
  SearchQueryDto,
  publicProductSort.SortQueryDto,
  ProductCategoryIdFilterDto,
) {}

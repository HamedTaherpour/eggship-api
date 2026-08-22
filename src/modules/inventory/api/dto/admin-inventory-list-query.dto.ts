import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import {
  createSortQueryDto,
  PaginationQueryDto,
  parseQueryBoolean,
  SearchQueryDto,
} from '../../../../common/list';

export const ADMIN_INVENTORY_SORT_FIELDS = [
  'productName',
  'onHand',
  'reserved',
  'available',
  'updatedAt',
] as const;

const adminInventorySort = createSortQueryDto({
  fields: ADMIN_INVENTORY_SORT_FIELDS,
  defaultSortBy: 'updatedAt',
  defaultSortOrder: 'desc',
});

export const resolveAdminInventoryListSort = adminInventorySort.resolveSort;

class AdminInventoryFiltersDto {
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
 * Admin Inventory list query: pagination + search (Product name) + sort allowlist +
 * optional isActive filter.
 */
export class AdminInventoryListQueryDto extends IntersectionType(
  PaginationQueryDto,
  SearchQueryDto,
  adminInventorySort.SortQueryDto,
  AdminInventoryFiltersDto,
) {}

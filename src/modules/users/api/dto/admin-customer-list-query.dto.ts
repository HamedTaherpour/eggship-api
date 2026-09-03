import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import {
  createSortQueryDto,
  PaginationQueryDto,
  parseQueryBoolean,
  SearchQueryDto,
} from '../../../../common/list';

export const ADMIN_CUSTOMER_SORT_FIELDS = ['createdAt', 'updatedAt'] as const;

const adminCustomerSort = createSortQueryDto({
  fields: ADMIN_CUSTOMER_SORT_FIELDS,
  defaultSortBy: 'createdAt',
  defaultSortOrder: 'desc',
});

export const resolveAdminCustomerSort = adminCustomerSort.resolveSort;

class AdminCustomerFilterDto {
  @ApiPropertyOptional({
    description:
      'When set, restrict to active (`true`) or disabled (`false`) store/customer accounts. Accepts only `true` / `false`.',
    type: Boolean,
    example: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'When set, restrict to accounts with (`true`) or without (`false`) immutable Visitor referral attribution. Accepts only `true` / `false`.',
    type: Boolean,
    example: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseQueryBoolean(value))
  @IsBoolean()
  hasReferral?: boolean;
}

/**
 * Admin customer/store list query: pagination + search (phone substring) +
 * sort allowlist + explicit `isActive` / `hasReferral` filters.
 */
export class AdminCustomerListQueryDto extends IntersectionType(
  PaginationQueryDto,
  SearchQueryDto,
  adminCustomerSort.SortQueryDto,
  AdminCustomerFilterDto,
) {}

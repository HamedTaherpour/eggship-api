import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import {
  createSortQueryDto,
  PaginationQueryDto,
  parseQueryBoolean,
  SearchQueryDto,
} from '../../../../common/list';
import { DiscountTarget, DiscountType } from '../../domain/discount';

export const DISCOUNT_SORT_FIELDS = [
  'name',
  'createdAt',
  'updatedAt',
  'precedence',
] as const;

const discountSort = createSortQueryDto({
  fields: DISCOUNT_SORT_FIELDS,
  defaultSortBy: 'createdAt',
  defaultSortOrder: 'desc',
});

export const resolveDiscountSort = discountSort.resolveSort;

const DISCOUNT_TYPES = Object.values(DiscountType);
const DISCOUNT_TARGETS = Object.values(DiscountTarget);

class DiscountIsActiveFilterDto {
  @ApiPropertyOptional({
    description:
      'When set, restrict to active (`true`) or inactive (`false`) discounts. Accepts only `true` / `false`.',
    type: Boolean,
    example: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;
}

class DiscountTypeFilterDto {
  @ApiPropertyOptional({
    description: 'When set, restrict to this discount type.',
    enum: DISCOUNT_TYPES,
  })
  @IsOptional()
  @IsIn(DISCOUNT_TYPES)
  type?: (typeof DiscountType)[keyof typeof DiscountType];
}

class DiscountTargetFilterDto {
  @ApiPropertyOptional({
    description: 'When set, restrict to this discount target scope.',
    enum: DISCOUNT_TARGETS,
  })
  @IsOptional()
  @IsIn(DISCOUNT_TARGETS)
  target?: (typeof DiscountTarget)[keyof typeof DiscountTarget];
}

/**
 * Admin Discount list query: pagination + search (name) + sort allowlist + filters.
 */
export class AdminDiscountListQueryDto extends IntersectionType(
  PaginationQueryDto,
  SearchQueryDto,
  discountSort.SortQueryDto,
  DiscountIsActiveFilterDto,
  DiscountTypeFilterDto,
  DiscountTargetFilterDto,
) {}

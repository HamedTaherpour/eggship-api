import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import {
  createSortQueryDto,
  PaginationQueryDto,
} from '../../../../common/list';
import { CUSTOMER_ORDER_SORT_FIELDS } from '../../domain/order-list';
import { OrderStatus } from '../../domain/order-status';

export { CUSTOMER_ORDER_SORT_FIELDS };

const customerOrderSort = createSortQueryDto({
  fields: CUSTOMER_ORDER_SORT_FIELDS,
  defaultSortBy: 'createdAt',
  defaultSortOrder: 'desc',
});

export const resolveCustomerOrderSort = customerOrderSort.resolveSort;

class CustomerOrderFiltersDto {
  @ApiPropertyOptional({
    enum: Object.values(OrderStatus),
    description: 'When set, restrict to this order status.',
  })
  @IsOptional()
  @IsIn(Object.values(OrderStatus))
  status?: OrderStatus;

  @ApiPropertyOptional({
    description:
      'Inclusive lower bound on createdAt (ISO 8601 UTC). Example: 2026-01-01T00:00:00.000Z',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional({
    description:
      'Inclusive upper bound on createdAt (ISO 8601 UTC). Example: 2026-12-31T23:59:59.999Z',
    example: '2026-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsISO8601()
  createdTo?: string;
}

/**
 * Customer Order list query: pagination + sort allowlist + optional status
 * and createdAt range. No free-text search. Unknown query params rejected.
 */
export class CustomerOrderListQueryDto extends IntersectionType(
  PaginationQueryDto,
  customerOrderSort.SortQueryDto,
  CustomerOrderFiltersDto,
) {}

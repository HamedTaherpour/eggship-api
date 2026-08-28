import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsISO8601, IsOptional, IsUUID } from 'class-validator';
import {
  createSortQueryDto,
  PaginationQueryDto,
} from '../../../../common/list';
import { ADMIN_ORDER_SORT_FIELDS } from '../../domain/order-list';
import { OrderStatus } from '../../domain/order-status';

const adminOrderSort = createSortQueryDto({
  fields: ADMIN_ORDER_SORT_FIELDS,
  defaultSortBy: 'createdAt',
  defaultSortOrder: 'desc',
});

export const resolveAdminOrderSort = adminOrderSort.resolveSort;

class AdminOrderFiltersDto {
  @ApiPropertyOptional({ enum: Object.values(OrderStatus) })
  @IsOptional()
  @IsIn(Object.values(OrderStatus))
  status?: OrderStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  regionId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsISO8601()
  createdTo?: string;
}

/** Admin Order list query. Search is intentionally not part of ORD-06. */
export class AdminOrderListQueryDto extends IntersectionType(
  PaginationQueryDto,
  adminOrderSort.SortQueryDto,
  AdminOrderFiltersDto,
) {}

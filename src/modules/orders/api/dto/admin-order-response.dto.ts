import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createPaginatedResponseDto } from '../../../../common/list';
import { orderMoneyToJson } from '../../domain/order-money';
import type { AdminOrderListRecord } from '../../domain/order-list';
import type { OrderRecord } from '../../domain/order';
import {
  CustomerOrderDetailDto,
  toCustomerOrderDetailDto,
} from './customer-order-response.dto';

export class AdminOrderListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({
    enum: [
      'PENDING_REVIEW',
      'CONFIRMED',
      'SHIPPED',
      'DELIVERED',
      'CANCELLED',
      'RETURNED',
    ],
  })
  status!: string;
  @ApiProperty({ example: '+989121234567' }) customerPhone!: string;
  @ApiProperty({ format: 'uuid' }) regionId!: string;
  @ApiProperty() regionName!: string;
  @ApiProperty({ oneOf: [{ type: 'number' }, { type: 'string' }] }) total!:
    number | string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) deliveryAt!:
    string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export const AdminOrderListResponseDto = createPaginatedResponseDto(
  AdminOrderListItemDto,
  { name: 'AdminOrderListResponseDto' },
);

/** Admin detail reuses persisted snapshot/pricing evidence and adds cancel metadata. */
export class AdminOrderDetailDto extends CustomerOrderDetailDto {
  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  cancelReason!: string | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class AdminOrderDetailResponseDto {
  @ApiProperty({ type: AdminOrderDetailDto }) data!: AdminOrderDetailDto;
}

export function toAdminOrderListItemDto(
  row: AdminOrderListRecord,
): AdminOrderListItemDto {
  return {
    id: row.id,
    status: row.status,
    customerPhone: row.customerPhone,
    regionId: row.regionId,
    regionName: row.regionName,
    total: orderMoneyToJson(row.total),
    deliveryAt: row.deliveryAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAdminOrderDetailDto(order: OrderRecord): AdminOrderDetailDto {
  return {
    ...toCustomerOrderDetailDto(order),
    cancelReason: order.cancelReason,
    updatedAt: order.updatedAt.toISOString(),
  };
}

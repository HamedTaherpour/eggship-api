import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createPaginatedResponseDto } from '../../../../common/list';
import { orderMoneyToJson } from '../../../orders/domain/order-money';
import { OrderStatus } from '../../../orders/domain/order-status';
import {
  SettlementStatus,
  type SettlementRecord,
} from '../../domain/settlement';

export class AdminSettlementDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({
    enum: OrderStatus,
    description:
      'Current Order status; Settlement lifecycle remains independent.',
  })
  orderStatus!: (typeof OrderStatus)[keyof typeof OrderStatus];

  @ApiProperty({
    oneOf: [{ type: 'number' }, { type: 'string' }],
    description:
      'Full immutable Order.total in Toman. Large exact values are decimal strings.',
  })
  orderTotal!: number | string;

  @ApiProperty({ enum: SettlementStatus })
  status!: SettlementRecord['status'];

  @ApiProperty({ type: String, format: 'date-time' })
  dueAt!: string;

  @ApiProperty({
    description:
      'Read-time derivation: OPEN and dueAt is before the server instant.',
  })
  overdue!: boolean;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  settledAt!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  settledByAdminId!: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Media id only; storage keys are never exposed.',
  })
  receiptMediaId!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  receiptAttachedAt!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  receiptAttachedByAdminId!: string | null;

  @ApiProperty({ format: 'uuid' })
  createdByAdminId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class AdminSettlementResponseDto {
  @ApiProperty({ type: AdminSettlementDto })
  data!: AdminSettlementDto;
}

export const AdminSettlementListResponseDto = createPaginatedResponseDto(
  AdminSettlementDto,
  { name: 'AdminSettlementListResponseDto' },
);

export function toAdminSettlementDto(
  record: SettlementRecord,
): AdminSettlementDto {
  return {
    id: record.id,
    orderId: record.orderId,
    orderStatus: record.orderStatus,
    orderTotal: orderMoneyToJson(record.orderTotal),
    status: record.status,
    dueAt: record.dueAt.toISOString(),
    overdue: record.overdue,
    settledAt: record.settledAt?.toISOString() ?? null,
    settledByAdminId: record.settledByAdminId,
    receiptMediaId: record.receiptMediaId,
    receiptAttachedAt: record.receiptAttachedAt?.toISOString() ?? null,
    receiptAttachedByAdminId: record.receiptAttachedByAdminId,
    createdByAdminId: record.createdByAdminId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

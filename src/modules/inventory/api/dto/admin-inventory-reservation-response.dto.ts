import { ApiProperty } from '@nestjs/swagger';
import { createPaginatedResponseDto } from '../../../../common/list';
import {
  InventoryReservationStatus,
  type InventoryReservation,
} from '../../domain/inventory-reservation';

export class AdminInventoryReservationItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'Opaque order identifier for Admin navigation. Inventory does not expose Order customer details.',
  })
  orderId!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({ enum: InventoryReservationStatus })
  status!: (typeof InventoryReservationStatus)[keyof typeof InventoryReservationStatus];

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export const AdminInventoryReservationListResponseDto =
  createPaginatedResponseDto(AdminInventoryReservationItemDto, {
    name: 'AdminInventoryReservationListResponseDto',
  });

export function toAdminInventoryReservationItemDto(
  row: InventoryReservation,
): AdminInventoryReservationItemDto {
  return {
    id: row.id,
    orderId: row.orderId,
    quantity: row.quantity,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

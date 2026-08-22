import { ApiProperty } from '@nestjs/swagger';
import { createPaginatedResponseDto } from '../../../../common/list';
import type { InventoryListRecord } from '../../domain/inventory-list';

export class AdminInventoryListItemDto {
  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ description: 'Current Product display name.' })
  productName!: string;

  @ApiProperty({
    description:
      'Whether the Product is active in catalog. Inactive products remain visible in Admin inventory.',
  })
  isActive!: boolean;

  @ApiProperty({ description: 'Sellable physical units in the warehouse.' })
  onHand!: number;

  @ApiProperty({ description: 'Units promised to open, unshipped orders.' })
  reserved!: number;

  @ApiProperty({
    description:
      'Derived sellable units (`onHand - reserved`). Never persisted.',
  })
  available!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export const AdminInventoryListResponseDto = createPaginatedResponseDto(
  AdminInventoryListItemDto,
  { name: 'AdminInventoryListResponseDto' },
);

export function toAdminInventoryListItemDto(
  row: InventoryListRecord,
): AdminInventoryListItemDto {
  return {
    productId: row.productId,
    productName: row.productName,
    isActive: row.isActive,
    onHand: row.onHand,
    reserved: row.reserved,
    available: row.available,
    updatedAt: row.updatedAt.toISOString(),
  };
}

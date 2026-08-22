import { ApiProperty } from '@nestjs/swagger';
import type { InventoryBalance } from '../../domain/inventory-balance';

export class InventoryBalanceDataDto {
  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({
    description: 'Sellable physical units currently in the warehouse.',
    example: 594,
  })
  onHand!: number;

  @ApiProperty({
    description: 'Units promised to open, unshipped orders.',
    example: 10,
  })
  reserved!: number;

  @ApiProperty({
    description:
      'Derived sellable units still available to promise (`onHand - reserved`).',
    example: 584,
  })
  available!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class InventoryBalanceResponseDto {
  @ApiProperty({ type: InventoryBalanceDataDto })
  data!: InventoryBalanceDataDto;
}

export function toInventoryBalanceDto(
  balance: InventoryBalance,
): InventoryBalanceDataDto {
  return {
    productId: balance.productId,
    onHand: balance.onHand,
    reserved: balance.reserved,
    available: balance.available,
    updatedAt: balance.updatedAt.toISOString(),
  };
}

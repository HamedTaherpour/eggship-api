import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import {
  INVENTORY_INT4_MAX,
  INVENTORY_QUANTITY_MIN,
} from '../../domain/inventory-quantity';

export class ReceiveStockBodyDto {
  @ApiProperty({
    description:
      'Whole sellable units to receive into warehouse on-hand stock.',
    minimum: INVENTORY_QUANTITY_MIN,
    maximum: INVENTORY_INT4_MAX,
    example: 500,
    type: Number,
  })
  @IsInt()
  @Min(INVENTORY_QUANTITY_MIN)
  @Max(INVENTORY_INT4_MAX)
  quantity!: number;
}

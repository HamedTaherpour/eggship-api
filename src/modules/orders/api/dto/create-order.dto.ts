import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  INVENTORY_INT4_MAX,
  INVENTORY_QUANTITY_MIN,
} from '../../../inventory/domain/inventory-quantity';

/**
 * One customer-controlled order line. Product identity and quantity only —
 * price, name, discounts, and totals are server-owned.
 */
export class CreateOrderLineDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Product to order. Must be sale-visible at create time.',
  })
  @IsUUID('4')
  productId!: string;

  @ApiProperty({
    description: 'Whole sellable units for this product.',
    minimum: INVENTORY_QUANTITY_MIN,
    maximum: INVENTORY_INT4_MAX,
    example: 2,
    type: Number,
  })
  @IsInt()
  @Min(INVENTORY_QUANTITY_MIN)
  @Max(INVENTORY_INT4_MAX)
  quantity!: number;
}

/**
 * Customer Order-create body (ORD-03A). Ownership, actor, money, phone,
 * discounts, status, and commerce-policy fields are never accepted here.
 */
export class CreateOrderBodyDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Active Region for this order. Name is snapshotted server-side.',
  })
  @IsUUID('4')
  regionId!: string;

  @ApiProperty({
    type: CreateOrderLineDto,
    isArray: true,
    minItems: 1,
    description:
      'Non-empty lines. Duplicate productIds are normalized by summing quantities before policy, pricing, and inventory checks. No HTTP-level SKU-count maximum is assigned.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderLineDto)
  lines!: CreateOrderLineDto[];
}

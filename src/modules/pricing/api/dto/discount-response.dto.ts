import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createPaginatedResponseDto } from '../../../../common/list';
import { DiscountTarget, DiscountType } from '../../domain/discount';
import type { DiscountRecord } from '../../domain/discount';

export class AdminDiscountDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Spring sale 10%' })
  name!: string;

  @ApiProperty({ enum: DiscountType })
  type!: (typeof DiscountType)[keyof typeof DiscountType];

  @ApiProperty({ enum: DiscountTarget })
  target!: (typeof DiscountTarget)[keyof typeof DiscountTarget];

  @ApiPropertyOptional({
    description: 'Whole-number percent when type is PERCENT.',
    nullable: true,
  })
  percentValue!: number | null;

  @ApiPropertyOptional({
    description: 'Integer Toman when type is FIXED.',
    nullable: true,
  })
  fixedAmount!: number | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  productId!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  categoryId!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
  })
  startsAt!: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
  })
  endsAt!: string | null;

  @ApiProperty({
    description: 'Opaque precedence input for calculation ordering (PRC-03).',
  })
  precedence!: number;

  @ApiPropertyOptional({
    description:
      'Per-customer lifetime discounted-quantity cap (PRODUCT only). Null = unlimited.',
    nullable: true,
  })
  maxQuantityPerCustomer!: number | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class AdminDiscountResponseDto {
  @ApiProperty({ type: AdminDiscountDto })
  data!: AdminDiscountDto;
}

export const AdminDiscountListResponseDto = createPaginatedResponseDto(
  AdminDiscountDto,
  { name: 'AdminDiscountListResponseDto' },
);

export function toAdminDiscountDto(record: DiscountRecord): AdminDiscountDto {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    target: record.target,
    percentValue: record.percentValue,
    fixedAmount: record.fixedAmount,
    productId: record.productId,
    categoryId: record.categoryId,
    isActive: record.isActive,
    startsAt: record.startsAt?.toISOString() ?? null,
    endsAt: record.endsAt?.toISOString() ?? null,
    precedence: record.precedence,
    maxQuantityPerCustomer: record.maxQuantityPerCustomer,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

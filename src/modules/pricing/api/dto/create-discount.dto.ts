import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  PRODUCT_PRICE_MAX_TOMAN,
  PRODUCT_PRICE_MIN_TOMAN,
} from '../../../products/domain/product-price';
import { DiscountTarget, DiscountType } from '../../domain/discount';
import type { CreateDiscountInput } from '../../domain/discount';
import { DISCOUNT_NAME_MAX_LENGTH } from '../../domain/discount-name';
import {
  DISCOUNT_PRECEDENCE_MAX,
  DISCOUNT_PRECEDENCE_MIN,
} from '../../domain/discount-precedence';
import {
  DISCOUNT_PERCENT_MAX,
  DISCOUNT_PERCENT_MIN,
} from '../../domain/discount-value';

const DISCOUNT_TYPES = Object.values(DiscountType);
const DISCOUNT_TARGETS = Object.values(DiscountTarget);

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function trimOptionalIso({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateDiscountBodyDto {
  @ApiProperty({
    description: 'Display name. Trimmed; 1–100 characters.',
    minLength: 1,
    maxLength: DISCOUNT_NAME_MAX_LENGTH,
    example: 'Spring sale 10%',
  })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(DISCOUNT_NAME_MAX_LENGTH)
  name!: string;

  @ApiProperty({ enum: DISCOUNT_TYPES, example: DiscountType.PERCENT })
  @IsIn(DISCOUNT_TYPES)
  type!: (typeof DiscountType)[keyof typeof DiscountType];

  @ApiProperty({ enum: DISCOUNT_TARGETS, example: DiscountTarget.ORDER })
  @IsIn(DISCOUNT_TARGETS)
  target!: (typeof DiscountTarget)[keyof typeof DiscountTarget];

  @ApiPropertyOptional({
    description: 'Required when type is PERCENT. Whole number 1–100.',
    minimum: DISCOUNT_PERCENT_MIN,
    maximum: DISCOUNT_PERCENT_MAX,
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(DISCOUNT_PERCENT_MIN)
  @Max(DISCOUNT_PERCENT_MAX)
  percentValue?: number;

  @ApiPropertyOptional({
    description: 'Required when type is FIXED. Integer Toman.',
    minimum: PRODUCT_PRICE_MIN_TOMAN,
    maximum: PRODUCT_PRICE_MAX_TOMAN,
    example: 50000,
  })
  @IsOptional()
  @IsInt()
  @Min(PRODUCT_PRICE_MIN_TOMAN)
  @Max(PRODUCT_PRICE_MAX_TOMAN)
  fixedAmount?: number;

  @ApiPropertyOptional({
    description: 'Required when target is PRODUCT.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  productId?: string;

  @ApiPropertyOptional({
    description: 'Required when target is CATEGORY.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'When omitted, defaults to true (active).',
    default: true,
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Optional UTC activation start (ISO 8601).',
    example: '2026-03-01T00:00:00.000Z',
  })
  @IsOptional()
  @Transform(trimOptionalIso)
  @IsISO8601()
  startsAt?: string;

  @ApiPropertyOptional({
    description:
      'Optional UTC activation end (ISO 8601). Exclusive upper bound.',
    example: '2026-04-01T00:00:00.000Z',
  })
  @IsOptional()
  @Transform(trimOptionalIso)
  @IsISO8601()
  endsAt?: string;

  @ApiPropertyOptional({
    description: 'Opaque precedence input for calculation ordering (PRC-03).',
    default: 0,
    minimum: DISCOUNT_PRECEDENCE_MIN,
    maximum: DISCOUNT_PRECEDENCE_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(DISCOUNT_PRECEDENCE_MIN)
  @Max(DISCOUNT_PRECEDENCE_MAX)
  precedence?: number;
}

export function toCreateDiscountInput(
  body: CreateDiscountBodyDto,
): CreateDiscountInput {
  return {
    name: body.name,
    type: body.type,
    target: body.target,
    percentValue: body.percentValue,
    fixedAmount: body.fixedAmount,
    productId: body.productId,
    categoryId: body.categoryId,
    isActive: body.isActive,
    startsAt: body.startsAt === undefined ? undefined : new Date(body.startsAt),
    endsAt: body.endsAt === undefined ? undefined : new Date(body.endsAt),
    precedence: body.precedence,
  };
}

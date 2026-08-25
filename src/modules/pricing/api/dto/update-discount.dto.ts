import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
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
  ValidateIf,
} from 'class-validator';
import { INVENTORY_INT4_MAX } from '../../../inventory/domain/inventory-quantity';
import {
  PRODUCT_PRICE_MAX_TOMAN,
  PRODUCT_PRICE_MIN_TOMAN,
} from '../../../products/domain/product-price';
import { DiscountTarget, DiscountType } from '../../domain/discount';
import type { UpdateDiscountInput } from '../../domain/discount';
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

/**
 * PATCH allowlist. Lifecycle activation uses dedicated activate/deactivate routes.
 * Id, timestamps, and unknown properties are rejected.
 */
export class UpdateDiscountBodyDto {
  @ApiPropertyOptional({
    description: 'Display name. Trimmed; 1–100 characters.',
    minLength: 1,
    maxLength: DISCOUNT_NAME_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(DISCOUNT_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ enum: DISCOUNT_TYPES })
  @IsOptional()
  @IsIn(DISCOUNT_TYPES)
  type?: (typeof DiscountType)[keyof typeof DiscountType];

  @ApiPropertyOptional({ enum: DISCOUNT_TARGETS })
  @IsOptional()
  @IsIn(DISCOUNT_TARGETS)
  target?: (typeof DiscountTarget)[keyof typeof DiscountTarget];

  @ApiPropertyOptional({
    description: 'Whole number 1–100 when type is PERCENT.',
    minimum: DISCOUNT_PERCENT_MIN,
    maximum: DISCOUNT_PERCENT_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(DISCOUNT_PERCENT_MIN)
  @Max(DISCOUNT_PERCENT_MAX)
  percentValue?: number;

  @ApiPropertyOptional({
    description: 'Integer Toman when type is FIXED.',
    minimum: PRODUCT_PRICE_MIN_TOMAN,
    maximum: PRODUCT_PRICE_MAX_TOMAN,
  })
  @IsOptional()
  @IsInt()
  @Min(PRODUCT_PRICE_MIN_TOMAN)
  @Max(PRODUCT_PRICE_MAX_TOMAN)
  fixedAmount?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  productId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'Optional UTC activation start (ISO 8601).',
  })
  @IsOptional()
  @Transform(trimOptionalIso)
  @IsISO8601()
  startsAt?: string;

  @ApiPropertyOptional({
    description:
      'Optional UTC activation end (ISO 8601). Exclusive upper bound.',
  })
  @IsOptional()
  @Transform(trimOptionalIso)
  @IsISO8601()
  endsAt?: string;

  @ApiPropertyOptional({
    description: 'Opaque precedence input for calculation ordering (PRC-03).',
    minimum: DISCOUNT_PRECEDENCE_MIN,
    maximum: DISCOUNT_PRECEDENCE_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(DISCOUNT_PRECEDENCE_MIN)
  @Max(DISCOUNT_PRECEDENCE_MAX)
  precedence?: number;

  @ApiPropertyOptional({
    description:
      'Optional per-customer lifetime discounted-quantity cap (PRODUCT only). Null clears the cap.',
    minimum: 1,
    maximum: INVENTORY_INT4_MAX,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(INVENTORY_INT4_MAX)
  maxQuantityPerCustomer?: number | null;
}

export function toUpdateDiscountInput(
  body: UpdateDiscountBodyDto,
): UpdateDiscountInput {
  return {
    name: body.name,
    type: body.type,
    target: body.target,
    percentValue: body.percentValue,
    fixedAmount: body.fixedAmount,
    productId: body.productId,
    categoryId: body.categoryId,
    startsAt: body.startsAt === undefined ? undefined : new Date(body.startsAt),
    endsAt: body.endsAt === undefined ? undefined : new Date(body.endsAt),
    precedence: body.precedence,
    maxQuantityPerCustomer: body.maxQuantityPerCustomer,
  };
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PRODUCT_NAME_MAX_LENGTH } from '../../domain/product-name';
import {
  PRODUCT_PRICE_MAX_TOMAN,
  PRODUCT_PRICE_MIN_TOMAN,
} from '../../domain/product-price';

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * PATCH allowlist. Only name, price, categoryId, and isActive are writable.
 * Id, timestamps, inventory fields, and unknown properties are rejected.
 * Current price mutation will integrate with PriceHistory in PRC-01.
 */
export class UpdateProductBodyDto {
  @ApiPropertyOptional({
    description: 'Display name / storefront title. Trimmed; 1–100 characters.',
    minLength: 1,
    maxLength: PRODUCT_NAME_MAX_LENGTH,
    example: 'Cage-free eggs (30)',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Current selling price as an integer number of Toman (not Rial). Updates overwrite current price only; PriceHistory is PRC-01.',
    minimum: PRODUCT_PRICE_MIN_TOMAN,
    maximum: PRODUCT_PRICE_MAX_TOMAN,
    example: 650000,
    type: Number,
  })
  @IsOptional()
  @IsInt()
  @Min(PRODUCT_PRICE_MIN_TOMAN)
  @Max(PRODUCT_PRICE_MAX_TOMAN)
  price?: number;

  @ApiPropertyOptional({
    description: 'Existing Category id (UUID).',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ApiPropertyOptional({
    description:
      'Activation flag. Prefer deactivation over hard delete when hiding a product.',
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

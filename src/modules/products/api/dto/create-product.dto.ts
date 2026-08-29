import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateProductBodyDto {
  @ApiProperty({
    description: 'Display name / storefront title. Trimmed; 1–100 characters.',
    minLength: 1,
    maxLength: PRODUCT_NAME_MAX_LENGTH,
    example: 'Cage-free eggs (30)',
  })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(PRODUCT_NAME_MAX_LENGTH)
  name!: string;

  @ApiProperty({
    description:
      'Current selling price as an integer number of Toman (not Rial). Example: 625000 means 625,000 Toman. Must be between 1 and 2147483647.',
    minimum: PRODUCT_PRICE_MIN_TOMAN,
    maximum: PRODUCT_PRICE_MAX_TOMAN,
    example: 625000,
    type: Number,
  })
  @IsInt()
  @Min(PRODUCT_PRICE_MIN_TOMAN)
  @Max(PRODUCT_PRICE_MAX_TOMAN)
  price!: number;

  @ApiProperty({
    description:
      'Existing Category id (UUID). Inactive categories may be assigned; public lists still hide products under inactive categories.',
    format: 'uuid',
  })
  @IsUUID('4')
  categoryId!: string;

  @ApiPropertyOptional({
    description: 'When omitted, defaults to true (active).',
    default: true,
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Optional supported image Media id.',
  })
  @IsOptional()
  @IsUUID('4')
  imageMediaId?: string | null;
}

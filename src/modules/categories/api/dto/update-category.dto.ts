import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CATEGORY_NAME_MAX_LENGTH } from '../../domain/category-name';

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * PATCH allowlist. Only `name` and `isActive` are writable.
 * Id, timestamps, and unknown properties are rejected.
 */
export class UpdateCategoryBodyDto {
  @ApiPropertyOptional({
    description: 'Display name. Trimmed; 1–100 characters.',
    minLength: 1,
    maxLength: CATEGORY_NAME_MAX_LENGTH,
    example: 'Dairy',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(CATEGORY_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Activation flag. Prefer deactivation over hard delete when hiding a category.',
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

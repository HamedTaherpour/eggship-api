import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { REGION_NAME_MAX_LENGTH } from '../../domain/region-name';

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * PATCH allowlist. Only `name` and `isActive` are writable.
 * Id, timestamps, and unknown properties are rejected.
 */
export class UpdateRegionBodyDto {
  @ApiPropertyOptional({
    description: 'Display name. Trimmed; 1–100 characters.',
    minLength: 1,
    maxLength: REGION_NAME_MAX_LENGTH,
    example: 'Tehran',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(REGION_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Activation flag. Prefer deactivation over hard delete when hiding a region.',
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

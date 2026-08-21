import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateRegionBodyDto {
  @ApiProperty({
    description: 'Display name. Trimmed; 1–100 characters.',
    minLength: 1,
    maxLength: REGION_NAME_MAX_LENGTH,
    example: 'Tehran',
  })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(REGION_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({
    description: 'When omitted, defaults to true (active).',
    default: true,
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

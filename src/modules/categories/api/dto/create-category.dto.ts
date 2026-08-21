import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateCategoryBodyDto {
  @ApiProperty({
    description: 'Display name. Trimmed; 1–100 characters.',
    minLength: 1,
    maxLength: CATEGORY_NAME_MAX_LENGTH,
    example: 'Dairy',
  })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(CATEGORY_NAME_MAX_LENGTH)
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

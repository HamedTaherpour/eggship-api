import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotEquals,
} from 'class-validator';
import { LEDGER_REASON_MAX_LENGTH } from '../../domain/inventory-ledger';
import { INVENTORY_INT4_MAX } from '../../domain/inventory-quantity';

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class AdjustStockBodyDto {
  @ApiProperty({
    description:
      'Signed on-hand delta (never an absolute on-hand target). Must be non-zero.',
    minimum: -INVENTORY_INT4_MAX,
    maximum: INVENTORY_INT4_MAX,
    example: -6,
    type: Number,
  })
  @IsInt()
  @NotEquals(0)
  @Min(-INVENTORY_INT4_MAX)
  @Max(INVENTORY_INT4_MAX)
  delta!: number;

  @ApiProperty({
    description: 'Required operator reason for the adjustment.',
    minLength: 1,
    maxLength: LEDGER_REASON_MAX_LENGTH,
    example: 'شکستگی هنگام جابه‌جایی',
  })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(LEDGER_REASON_MAX_LENGTH)
  reason!: string;
}

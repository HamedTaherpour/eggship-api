import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { OrderReturnRecord } from '../../domain/order-return';

export class RecordOrderReturnLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderLineId!: string;

  @ApiProperty({ minimum: 0, example: 2 })
  @IsInt()
  @Min(0)
  sellableQuantity!: number;

  @ApiProperty({ minimum: 0, example: 1 })
  @IsInt()
  @Min(0)
  damagedQuantity!: number;
}

export class RecordOrderReturnBodyDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 500,
    example: 'Inspection completed.',
  })
  @IsString()
  @MaxLength(500)
  reason!: string;

  @ApiProperty({ type: [RecordOrderReturnLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecordOrderReturnLineDto)
  lines!: RecordOrderReturnLineDto[];
}

export class OrderReturnLineResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) orderLineId!: string;
  @ApiProperty({ minimum: 0 }) sellableQuantity!: number;
  @ApiProperty({ minimum: 0 }) damagedQuantity!: number;
}

export class OrderReturnResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: [OrderReturnLineResponseDto] })
  lines!: OrderReturnLineResponseDto[];
}

export class RecordOrderReturnResponseDto {
  @ApiProperty({ type: OrderReturnResponseDto }) data!: OrderReturnResponseDto;
}

export function toOrderReturnResponseDto(
  value: OrderReturnRecord,
): OrderReturnResponseDto {
  return {
    id: value.id,
    orderId: value.orderId,
    reason: value.reason,
    createdAt: value.createdAt.toISOString(),
    lines: value.lines.map((line) => ({
      id: line.id,
      orderLineId: line.orderLineId,
      sellableQuantity: line.sellableQuantity,
      damagedQuantity: line.damagedQuantity,
    })),
  };
}

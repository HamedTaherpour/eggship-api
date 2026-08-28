import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class ConfirmOrderBodyDto {
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsISO8601()
  deliveryAt?: string;
}

export class AdminCancelOrderBodyDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 500,
    example: 'Customer requested cancellation.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancelReason?: string;
}

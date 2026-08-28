import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateSettlementBodyDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Absolute ISO 8601 instant. Past dates are allowed.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  dueAt!: string;
}

export class ChangeSettlementDueDateBodyDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Absolute ISO 8601 instant. Past dates are allowed.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  dueAt!: string;
}

export class AttachSettlementReceiptBodyDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Existing JPEG, PNG, or WebP Media id.',
  })
  @IsUUID()
  mediaId!: string;
}

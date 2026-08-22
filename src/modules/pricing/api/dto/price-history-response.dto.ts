import { ApiProperty } from '@nestjs/swagger';
import { createPaginatedResponseDto } from '../../../../common/list';
import { PriceHistoryActorType } from '../../domain/price-history-actor';
import type { PriceHistoryRecord } from '../../domain/price-history';

export class AdminPriceHistoryItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({
    description: 'Previous price in integer Toman before this change.',
  })
  oldPrice!: number;

  @ApiProperty({
    description: 'New price in integer Toman after this change.',
  })
  newPrice!: number;

  @ApiProperty({ enum: PriceHistoryActorType })
  actorType!: (typeof PriceHistoryActorType)[keyof typeof PriceHistoryActorType];

  @ApiProperty({ format: 'uuid' })
  actorId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export const AdminPriceHistoryListResponseDto = createPaginatedResponseDto(
  AdminPriceHistoryItemDto,
  { name: 'AdminPriceHistoryListResponseDto' },
);

export function toAdminPriceHistoryItemDto(
  record: PriceHistoryRecord,
): AdminPriceHistoryItemDto {
  return {
    id: record.id,
    productId: record.productId,
    oldPrice: record.oldPrice,
    newPrice: record.newPrice,
    actorType: record.actorType,
    actorId: record.actorId,
    createdAt: record.createdAt.toISOString(),
  };
}

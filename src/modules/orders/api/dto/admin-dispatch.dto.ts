import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { orderMoneyToJson } from '../../domain/order-money';
import {
  ADMIN_DISPATCH_ORDER_LIMIT,
  DISPATCH_PIPELINE_STATUSES,
  type AdminDispatchBoard,
  type AdminDispatchOrderRecord,
  type DispatchPipelineStatus,
} from '../../domain/order-dispatch';

/** Bounded Admin Dispatch query — pipeline statuses and region only. */
export class AdminDispatchQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  regionId?: string;

  @ApiPropertyOptional({
    enum: DISPATCH_PIPELINE_STATUSES,
    description:
      'Optional filter within the V1 dispatch pipeline (CONFIRMED or SHIPPED only).',
  })
  @IsOptional()
  @IsIn([...DISPATCH_PIPELINE_STATUSES])
  status?: DispatchPipelineStatus;
}

export class AdminDispatchOrderItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: DISPATCH_PIPELINE_STATUSES })
  status!: DispatchPipelineStatus;

  @ApiProperty({ example: '+989121234567' })
  customerPhone!: string;

  @ApiProperty({ format: 'uuid' })
  regionId!: string;

  @ApiProperty()
  regionName!: string;

  @ApiProperty({ oneOf: [{ type: 'number' }, { type: 'string' }] })
  total!: number | string;

  @ApiProperty({
    type: Number,
    description: 'Number of order lines (no line payloads).',
  })
  lineCount!: number;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  deliveryAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  confirmedAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  shippedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AdminDispatchRegionRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class AdminDispatchRegionGroupDto {
  @ApiProperty({ type: AdminDispatchRegionRefDto })
  region!: AdminDispatchRegionRefDto;

  @ApiProperty({ type: Number })
  ordersCount!: number;

  @ApiProperty({ type: AdminDispatchOrderItemDto, isArray: true })
  orders!: AdminDispatchOrderItemDto[];
}

export class AdminDispatchSummaryDto {
  @ApiProperty({
    type: Number,
    description: 'Orders included in this response after the bound.',
  })
  ordersCount!: number;

  @ApiProperty({ type: Number })
  confirmedCount!: number;

  @ApiProperty({ type: Number })
  shippedCount!: number;

  @ApiProperty({ type: Number })
  regionCount!: number;

  @ApiProperty({
    type: Number,
    example: ADMIN_DISPATCH_ORDER_LIMIT,
    description: 'Maximum Orders returned in one dispatch response.',
  })
  limit!: number;

  @ApiProperty({
    type: Boolean,
    description:
      'True when matchedCount exceeds the Orders included in this response.',
  })
  truncated!: boolean;

  @ApiProperty({
    type: Number,
    description: 'Total Orders matching filters before the bound.',
  })
  matchedCount!: number;
}

export class AdminDispatchBoardDto {
  @ApiProperty({ type: AdminDispatchSummaryDto })
  summary!: AdminDispatchSummaryDto;

  @ApiProperty({ type: AdminDispatchRegionGroupDto, isArray: true })
  groups!: AdminDispatchRegionGroupDto[];
}

export class AdminDispatchResponseDto {
  @ApiProperty({ type: AdminDispatchBoardDto })
  data!: AdminDispatchBoardDto;
}

export function toAdminDispatchOrderItemDto(
  row: AdminDispatchOrderRecord,
): AdminDispatchOrderItemDto {
  return {
    id: row.id,
    status: row.status,
    customerPhone: row.customerPhone,
    regionId: row.regionId,
    regionName: row.regionName,
    total: orderMoneyToJson(row.total),
    lineCount: row.lineCount,
    deliveryAt: row.deliveryAt?.toISOString() ?? null,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAdminDispatchBoardDto(
  board: AdminDispatchBoard,
): AdminDispatchBoardDto {
  return {
    summary: { ...board.summary },
    groups: board.groups.map((group) => ({
      region: { id: group.region.id, name: group.region.name },
      ordersCount: group.ordersCount,
      orders: group.orders.map(toAdminDispatchOrderItemDto),
    })),
  };
}

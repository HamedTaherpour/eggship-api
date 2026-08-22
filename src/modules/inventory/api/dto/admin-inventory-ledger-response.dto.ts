import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createPaginatedResponseDto } from '../../../../common/list';
import {
  InventoryLedgerActorType,
  InventoryLedgerReferenceType,
  InventoryLedgerType,
  type InventoryLedgerEntry,
} from '../../domain/inventory-ledger';

export class AdminInventoryLedgerItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: InventoryLedgerType })
  type!: (typeof InventoryLedgerType)[keyof typeof InventoryLedgerType];

  @ApiProperty({ description: 'Positive movement magnitude.' })
  quantity!: number;

  @ApiProperty()
  onHandDelta!: number;

  @ApiProperty()
  reservedDelta!: number;

  @ApiProperty()
  onHandAfter!: number;

  @ApiProperty()
  reservedAfter!: number;

  @ApiProperty({ enum: InventoryLedgerReferenceType })
  referenceType!: (typeof InventoryLedgerReferenceType)[keyof typeof InventoryLedgerReferenceType];

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  referenceId!: string | null;

  @ApiProperty({ enum: InventoryLedgerActorType })
  actorType!: (typeof InventoryLedgerActorType)[keyof typeof InventoryLedgerActorType];

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  actorId!: string | null;

  @ApiPropertyOptional({
    description: 'Operational reason when recorded (for example ADJUST).',
    nullable: true,
  })
  reason!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export const AdminInventoryLedgerListResponseDto = createPaginatedResponseDto(
  AdminInventoryLedgerItemDto,
  { name: 'AdminInventoryLedgerListResponseDto' },
);

export function toAdminInventoryLedgerItemDto(
  entry: InventoryLedgerEntry,
): AdminInventoryLedgerItemDto {
  return {
    id: entry.id,
    type: entry.type,
    quantity: entry.quantity,
    onHandDelta: entry.onHandDelta,
    reservedDelta: entry.reservedDelta,
    onHandAfter: entry.onHandAfter,
    reservedAfter: entry.reservedAfter,
    referenceType: entry.referenceType,
    referenceId: entry.referenceId,
    actorType: entry.actorType,
    actorId: entry.actorId,
    reason: entry.reason,
    createdAt: entry.createdAt.toISOString(),
  };
}

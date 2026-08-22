import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../../common/list';
import { InventoryLedgerType } from '../../domain/inventory-ledger';

const LEDGER_TYPES = Object.values(InventoryLedgerType);

class AdminInventoryLedgerFiltersDto {
  @ApiPropertyOptional({
    description: 'When set, restrict to this ledger event type.',
    enum: LEDGER_TYPES,
  })
  @IsOptional()
  @IsIn(LEDGER_TYPES)
  type?: (typeof InventoryLedgerType)[keyof typeof InventoryLedgerType];

  @ApiPropertyOptional({
    description:
      'Inclusive lower bound on createdAt (ISO 8601 UTC). Example: 2026-01-01T00:00:00.000Z',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional({
    description:
      'Inclusive upper bound on createdAt (ISO 8601 UTC). Example: 2026-12-31T23:59:59.999Z',
    example: '2026-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsISO8601()
  createdTo?: string;
}

/** Admin Inventory ledger history query: pagination + optional type/date filters. */
export class AdminInventoryLedgerListQueryDto extends IntersectionType(
  PaginationQueryDto,
  AdminInventoryLedgerFiltersDto,
) {}

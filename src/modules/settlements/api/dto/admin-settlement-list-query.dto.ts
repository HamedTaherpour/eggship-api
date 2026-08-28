import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import {
  createSortQueryDto,
  PaginationQueryDto,
  parseQueryBoolean,
} from '../../../../common/list';
import { SettlementStatus } from '../../domain/settlement';

export const SETTLEMENT_SORT_FIELDS = [
  'dueAt',
  'createdAt',
  'settledAt',
] as const;

const settlementSort = createSortQueryDto({
  fields: SETTLEMENT_SORT_FIELDS,
  defaultSortBy: 'dueAt',
  defaultSortOrder: 'asc',
});

export const resolveSettlementSort = settlementSort.resolveSort;

class SettlementFiltersDto {
  @ApiPropertyOptional({ enum: SettlementStatus })
  @IsOptional()
  @IsIn(Object.values(SettlementStatus))
  status?: SettlementStatus;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Derived as OPEN with dueAt earlier than the server read instant.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseQueryBoolean(value))
  @IsBoolean()
  overdue?: boolean;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Inclusive dueAt lower bound.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  dueFrom?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Inclusive dueAt upper bound.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  dueTo?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Exact Order id.' })
  @IsOptional()
  @IsUUID()
  orderId?: string;
}

export class AdminSettlementListQueryDto extends IntersectionType(
  PaginationQueryDto,
  settlementSort.SortQueryDto,
  SettlementFiltersDto,
) {}

import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../../common/list';
import { InventoryReservationStatus } from '../../domain/inventory-reservation';

const RESERVATION_STATUSES = Object.values(InventoryReservationStatus);

class AdminInventoryReservationFiltersDto {
  @ApiPropertyOptional({
    description: 'When set, restrict to reservations in this status.',
    enum: RESERVATION_STATUSES,
  })
  @IsOptional()
  @IsIn(RESERVATION_STATUSES)
  status?: (typeof InventoryReservationStatus)[keyof typeof InventoryReservationStatus];
}

/** Admin Inventory reservation diagnostics query: pagination + optional status filter. */
export class AdminInventoryReservationListQueryDto extends IntersectionType(
  PaginationQueryDto,
  AdminInventoryReservationFiltersDto,
) {}

import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsIn,
  IsOptional,
  IsUUID,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  createSortQueryDto,
  PaginationQueryDto,
} from '../../../../common/list';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../../domain/audit-event';

export const ADMIN_AUDIT_LOG_SORT_FIELDS = ['occurredAt'] as const;
const auditLogSort = createSortQueryDto({
  fields: ADMIN_AUDIT_LOG_SORT_FIELDS,
  defaultSortBy: 'occurredAt',
  defaultSortOrder: 'desc',
});
export const resolveAdminAuditLogSort = auditLogSort.resolveSort;

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

class AdminAuditLogFiltersDto {
  @ApiPropertyOptional({ enum: Object.values(AuditAction) })
  @IsOptional()
  @IsIn(Object.values(AuditAction))
  action?: AuditAction;

  @ApiPropertyOptional({ enum: Object.values(AuditEntityType) })
  @IsOptional()
  @IsEnum(AuditEntityType)
  entityType?: AuditEntityType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional({ enum: Object.values(AuditActorType) })
  @IsOptional()
  @IsEnum(AuditActorType)
  actorType?: AuditActorType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @IsString()
  @MaxLength(128)
  requestId?: string;

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @IsString()
  @MaxLength(128)
  correlationId?: string;

  @ApiPropertyOptional({ description: 'Inclusive lower bound, ISO 8601 UTC.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @IsISO8601()
  occurredFrom?: string;

  @ApiPropertyOptional({ description: 'Inclusive upper bound, ISO 8601 UTC.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trim(value))
  @IsISO8601()
  occurredTo?: string;
}

export class AdminAuditLogListQueryDto extends IntersectionType(
  PaginationQueryDto,
  auditLogSort.SortQueryDto,
  AdminAuditLogFiltersDto,
) {}

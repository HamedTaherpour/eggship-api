import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createPaginatedResponseDto } from '../../../../common/list';
import type { AuditLogReadRecord } from '../../infrastructure/audit-log.repository';

export class AdminAuditLogListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() occurredAt!: string;
  @ApiProperty() actorType!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) actorId!:
    string | null;
  @ApiProperty() action!: string;
  @ApiProperty() entityType!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) entityId!:
    string | null;
  @ApiPropertyOptional({ nullable: true }) requestId!: string | null;
  @ApiPropertyOptional({ nullable: true }) correlationId!: string | null;
}

export class AdminAuditLogDetailDto extends AdminAuditLogListItemDto {
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true })
  metadata!: Record<string, unknown> | null;
}

export class AdminAuditLogResponseDto {
  @ApiProperty({ type: AdminAuditLogDetailDto }) data!: AdminAuditLogDetailDto;
}

export const AdminAuditLogListResponseDto = createPaginatedResponseDto(
  AdminAuditLogListItemDto,
  { name: 'AdminAuditLogListResponseDto' },
);

export function toAdminAuditLogListItemDto(
  record: AuditLogReadRecord,
): AdminAuditLogListItemDto {
  return {
    id: record.id,
    occurredAt: record.occurredAt.toISOString(),
    actorType: record.actorType,
    actorId: record.actorId,
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId,
    requestId: record.requestId,
    correlationId: record.correlationId,
  };
}

export function toAdminAuditLogDetailDto(
  record: AuditLogReadRecord,
): AdminAuditLogDetailDto {
  const item = toAdminAuditLogListItemDto(record);
  return {
    ...item,
    metadata: isSafeMetadata(record.metadata) ? record.metadata : null,
  };
}

function isSafeMetadata(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

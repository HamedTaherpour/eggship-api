import type {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from './audit-event';

export type AuditLogSortField = 'occurredAt';

export interface AuditLogListQuery {
  page: number;
  pageSize: number;
  action?: AuditAction;
  entityType?: AuditEntityType;
  entityId?: string;
  actorType?: AuditActorType;
  actorId?: string;
  requestId?: string;
  correlationId?: string;
  occurredFrom?: Date;
  occurredTo?: Date;
  sortBy: AuditLogSortField;
  sortOrder: 'asc' | 'desc';
}

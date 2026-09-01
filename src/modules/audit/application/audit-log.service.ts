import { Injectable } from '@nestjs/common';
import { RequestContextService } from '../../../common/observability/request-context.service';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import {
  AuditLogRepository,
  type AuditLogRecord,
  type AuditLogReadRecord,
} from '../infrastructure/audit-log.repository';
import { normalizeAuditEvent, type AuditEvent } from '../domain/audit-event';
import {
  resolvePageRequest,
  toPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/list';
import type { AdminAuditLogListQueryDto } from '../api/dto/admin-audit-log-list-query.dto';
import { resolveAdminAuditLogSort } from '../api/dto/admin-audit-log-list-query.dto';
import { AuditLogNotFoundError } from '../domain/audit-log-errors';

/** The single application append boundary. Context linkage is never caller supplied. */
@Injectable()
export class AuditLogService {
  constructor(
    private readonly repository: AuditLogRepository,
    private readonly requestContext: RequestContextService,
  ) {}

  append(event: AuditEvent, tx?: TransactionContext): Promise<AuditLogRecord> {
    const normalized = normalizeAuditEvent(event);
    const context = this.requestContext.get();
    return this.repository.append(
      {
        ...normalized,
        requestId: context?.requestId ?? null,
        correlationId: context?.correlationId ?? null,
      },
      tx,
    );
  }

  async listAdmin(
    query: AdminAuditLogListQueryDto,
  ): Promise<PaginatedResponse<AuditLogReadRecord>> {
    const pageRequest = resolvePageRequest(query);
    const sort = resolveAdminAuditLogSort(query);
    const page = await this.repository.list({
      page: pageRequest.page,
      pageSize: pageRequest.pageSize,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
      action: query.action,
      entityType: query.entityType,
      entityId: query.entityId,
      actorType: query.actorType,
      actorId: query.actorId,
      requestId: query.requestId,
      correlationId: query.correlationId,
      occurredFrom:
        query.occurredFrom === undefined
          ? undefined
          : new Date(query.occurredFrom),
      occurredTo:
        query.occurredTo === undefined ? undefined : new Date(query.occurredTo),
    });
    return toPaginatedResponse(page.items, pageRequest, page.total);
  }

  async getAdminById(id: string): Promise<AuditLogReadRecord> {
    const record = await this.repository.findById(id);
    if (record === null) throw new AuditLogNotFoundError();
    return record;
  }
}

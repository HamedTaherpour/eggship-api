import { Injectable } from '@nestjs/common';
import { RequestContextService } from '../../../common/observability/request-context.service';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import {
  AuditLogRepository,
  type AuditLogRecord,
} from '../infrastructure/audit-log.repository';
import { normalizeAuditEvent, type AuditEvent } from '../domain/audit-event';

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
}

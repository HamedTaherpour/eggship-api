import { RequestContextService } from '../../../common/observability/request-context.service';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../domain/audit-event';
import { AuditLogService } from './audit-log.service';
import type {
  AuditLogRepository,
  AuditLogRecord,
} from '../infrastructure/audit-log.repository';

function createRepository(): {
  repository: AuditLogRepository;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  const repository = {
    append: (...args: unknown[]): Promise<AuditLogRecord> => {
      calls.push(args);
      return Promise.resolve({} as AuditLogRecord);
    },
  } as unknown as AuditLogRepository;
  return { repository, calls };
}

describe('AuditLogService', () => {
  it('ignores caller-supplied request/correlation fields and handles no context', async () => {
    const { repository, calls } = createRepository();
    const context = new RequestContextService();
    const service = new AuditLogService(repository, context);
    await service.append({
      action: AuditAction.ORDER_CREATED,
      actorType: AuditActorType.SYSTEM,
      actorId: null,
      entityType: AuditEntityType.ORDER,
      entityId: '11111111-1111-4111-8111-111111111111',
      metadata: undefined,
      requestId: 'spoofed',
      correlationId: 'spoofed',
    } as never);
    const normalized = calls[0]?.[0] as {
      requestId: string | null;
      correlationId: string | null;
    };
    expect(normalized.requestId).toBeNull();
    expect(normalized.correlationId).toBeNull();
  });

  it('uses the current infrastructure context', async () => {
    const { repository, calls } = createRepository();
    const context = new RequestContextService();
    const service = new AuditLogService(repository, context);
    await context.run(
      { requestId: 'req_real', correlationId: 'corr_real' },
      () =>
        service.append({
          action: AuditAction.ORDER_CREATED,
          actorType: AuditActorType.SYSTEM,
          actorId: null,
          entityType: AuditEntityType.ORDER,
          entityId: '11111111-1111-4111-8111-111111111111',
          metadata: undefined,
        }),
    );
    const normalized = calls[0]?.[0] as {
      requestId: string;
      correlationId: string;
    };
    expect(normalized).toMatchObject({
      requestId: 'req_real',
      correlationId: 'corr_real',
    });
  });
});

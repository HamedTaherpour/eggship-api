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
  AuditLogReadRecord,
} from '../infrastructure/audit-log.repository';
import { AuditLogNotFoundError } from '../domain/audit-log-errors';

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

  it('translates the allowlisted Admin query and returns canonical pagination', async () => {
    const row = {
      id: '11111111-1111-4111-8111-111111111111',
      occurredAt: new Date('2026-08-21T12:00:00.000Z'),
      actorType: 'ADMIN',
      actorId: null,
      action: AuditAction.ORDER_CREATED,
      entityType: 'ORDER',
      entityId: '22222222-2222-4222-8222-222222222222',
      requestId: 'req_1',
      correlationId: 'corr_1',
      metadata: null,
    } satisfies AuditLogReadRecord;
    const list = jest.fn().mockResolvedValue({ items: [row], total: 3 });
    const repository = {
      list,
    } as unknown as AuditLogRepository;
    const service = new AuditLogService(
      repository,
      new RequestContextService(),
    );

    const result = await service.listAdmin({
      page: 2,
      pageSize: 1,
      action: AuditAction.ORDER_CREATED,
      entityId: row.entityId,
      occurredFrom: '2026-08-01T00:00:00.000Z',
      sortBy: 'occurredAt',
      sortOrder: 'desc',
    });

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 2,
        pageSize: 1,
        action: AuditAction.ORDER_CREATED,
        entityId: row.entityId,
        occurredFrom: new Date('2026-08-01T00:00:00.000Z'),
        sortBy: 'occurredAt',
        sortOrder: 'desc',
      }),
    );
    expect(result.meta).toEqual({
      page: 2,
      pageSize: 1,
      total: 3,
      totalPages: 3,
    });
  });

  it('returns a stable not-found error for an absent Admin detail record', async () => {
    const repository = {
      findById: jest.fn().mockResolvedValue(null),
    } as unknown as AuditLogRepository;
    const service = new AuditLogService(
      repository,
      new RequestContextService(),
    );

    await expect(
      service.getAdminById('11111111-1111-4111-8111-111111111111'),
    ).rejects.toBeInstanceOf(AuditLogNotFoundError);
  });
});

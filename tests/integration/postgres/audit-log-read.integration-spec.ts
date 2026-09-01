import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { postgresIntegrationImports } from '../support/postgres-testing-module';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { Prisma } from '../../../src/generated/prisma/client';
import { AuditModule } from '../../../src/modules/audit/audit.module';
import { AuditLogService } from '../../../src/modules/audit/application/audit-log.service';
import { AuditLogRepository } from '../../../src/modules/audit/infrastructure/audit-log.repository';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../../../src/modules/audit/domain/audit-event';
import { AuditLogNotFoundError } from '../../../src/modules/audit/domain/audit-log-errors';
import {
  toAdminAuditLogDetailDto,
  toAdminAuditLogListItemDto,
} from '../../../src/modules/audit/api/dto/audit-log-response.dto';

const CORRELATION_PREFIX = 'aud03-read-test';

type ExplainRow = {
  'QUERY PLAN': Array<{ Plan: { 'Node Type': string; Plans?: unknown[] } }>;
};

type SeedRow = {
  id: string;
  occurredAt: Date;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  requestId: string | null;
  correlationId: string;
  metadata: Record<string, unknown> | null;
};

describe('AuditLog read APIs (PostgreSQL integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let repository: AuditLogRepository;
  let service: AuditLogService;

  const actorAdminId = 'b1111111-1111-4111-8111-111111111111';
  const actorUserId = 'b2222222-2222-4222-8222-222222222222';
  const entityOrderA = 'c1111111-1111-4111-8111-111111111111';
  const entityOrderB = 'c2222222-2222-4222-8222-222222222222';
  const entityProduct = 'c3333333-3333-4333-8333-333333333333';
  const tieOccurredAt = new Date('2026-08-15T12:00:00.000Z');
  const seedRows: SeedRow[] = [
    {
      id: 'a0000001-0000-4000-8000-000000000001',
      occurredAt: new Date('2026-08-10T10:00:00.000Z'),
      actorType: AuditActorType.SYSTEM,
      actorId: null,
      action: AuditAction.ORDER_CREATED,
      entityType: AuditEntityType.ORDER,
      entityId: entityOrderA,
      requestId: 'req_aud03_a',
      correlationId: CORRELATION_PREFIX,
      metadata: null,
    },
    {
      id: 'a0000002-0000-4000-8000-000000000002',
      occurredAt: new Date('2026-08-12T14:00:00.000Z'),
      actorType: AuditActorType.ADMIN,
      actorId: actorAdminId,
      action: AuditAction.ORDER_CONFIRMED,
      entityType: AuditEntityType.ORDER,
      entityId: entityOrderA,
      requestId: 'req_aud03_b',
      correlationId: CORRELATION_PREFIX,
      metadata: null,
    },
    {
      id: 'a0000003-0000-4000-8000-000000000003',
      occurredAt: new Date('2026-08-14T16:00:00.000Z'),
      actorType: AuditActorType.USER,
      actorId: actorUserId,
      action: AuditAction.ORDER_CANCELLED,
      entityType: AuditEntityType.ORDER,
      entityId: entityOrderB,
      requestId: 'req_aud03_c',
      correlationId: CORRELATION_PREFIX,
      metadata: null,
    },
    {
      id: 'a0000010-0000-4000-8000-000000000010',
      occurredAt: tieOccurredAt,
      actorType: AuditActorType.ADMIN,
      actorId: actorAdminId,
      action: AuditAction.PRICE_CHANGED,
      entityType: AuditEntityType.PRODUCT,
      entityId: entityProduct,
      requestId: 'req_aud03_tie_a',
      correlationId: CORRELATION_PREFIX,
      metadata: { previousPrice: 1000, newPrice: 1200 },
    },
    {
      id: 'a0000011-0000-4000-8000-000000000011',
      occurredAt: tieOccurredAt,
      actorType: AuditActorType.ADMIN,
      actorId: actorAdminId,
      action: AuditAction.PRODUCT_UPDATED,
      entityType: AuditEntityType.PRODUCT,
      entityId: entityProduct,
      requestId: 'req_aud03_tie_b',
      correlationId: CORRELATION_PREFIX,
      metadata: { changedFields: ['name'] },
    },
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: postgresIntegrationImports([AuditModule]),
    }).compile();
    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    repository = moduleRef.get(AuditLogRepository);
    service = moduleRef.get(AuditLogService);
    await app.init();
  });

  beforeEach(async () => {
    assertDestructiveOperationsAllowed();
    await prisma.auditLog.deleteMany({
      where: { correlationId: { startsWith: CORRELATION_PREFIX } },
    });
    await prisma.auditLog.createMany({
      data: seedRows.map((row) => ({
        ...row,
        metadata:
          row.metadata === null
            ? Prisma.JsonNull
            : (row.metadata as Prisma.InputJsonValue),
      })),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  function scopedRows(): SeedRow[] {
    return seedRows;
  }

  it('paginates with stable default occurredAt/id ordering and total count', async () => {
    const page1 = await service.listAdmin({
      page: 1,
      pageSize: 2,
      sortBy: 'occurredAt',
      sortOrder: 'desc',
      correlationId: CORRELATION_PREFIX,
    });
    expect(page1.meta).toMatchObject({
      page: 1,
      pageSize: 2,
      total: 5,
      totalPages: 3,
    });
    expect(page1.data.map((row) => row.id)).toEqual([
      'a0000011-0000-4000-8000-000000000011',
      'a0000010-0000-4000-8000-000000000010',
    ]);

    const page2 = await service.listAdmin({
      page: 2,
      pageSize: 2,
      sortBy: 'occurredAt',
      sortOrder: 'desc',
      correlationId: CORRELATION_PREFIX,
    });
    expect(page2.data.map((row) => row.id)).toEqual([
      'a0000003-0000-4000-8000-000000000003',
      'a0000002-0000-4000-8000-000000000002',
    ]);
  });

  it('uses id as a deterministic tie-break when occurredAt matches', async () => {
    const desc = await repository.list({
      page: 1,
      pageSize: 10,
      sortBy: 'occurredAt',
      sortOrder: 'desc',
      entityId: entityProduct,
    });
    expect(desc.items.map((row) => row.id)).toEqual([
      'a0000011-0000-4000-8000-000000000011',
      'a0000010-0000-4000-8000-000000000010',
    ]);

    const asc = await repository.list({
      page: 1,
      pageSize: 10,
      sortBy: 'occurredAt',
      sortOrder: 'asc',
      entityId: entityProduct,
    });
    expect(asc.items.map((row) => row.id)).toEqual([
      'a0000010-0000-4000-8000-000000000010',
      'a0000011-0000-4000-8000-000000000011',
    ]);
  });

  it.each([
    [
      'action',
      { action: AuditAction.ORDER_CREATED },
      (row: SeedRow): boolean => row.action === AuditAction.ORDER_CREATED,
    ],
    [
      'entityType',
      { entityType: AuditEntityType.PRODUCT },
      (row: SeedRow): boolean => row.entityType === AuditEntityType.PRODUCT,
    ],
    [
      'entityId',
      { entityId: entityOrderB },
      (row: SeedRow): boolean => row.entityId === entityOrderB,
    ],
    [
      'actorType',
      { actorType: AuditActorType.ADMIN },
      (row: SeedRow): boolean => row.actorType === AuditActorType.ADMIN,
    ],
    [
      'actorId',
      { actorId: actorUserId },
      (row: SeedRow): boolean => row.actorId === actorUserId,
    ],
    [
      'requestId',
      { requestId: 'req_aud03_b' },
      (row: SeedRow): boolean => row.requestId === 'req_aud03_b',
    ],
    [
      'correlationId',
      { correlationId: CORRELATION_PREFIX },
      (row: SeedRow): boolean => row.correlationId === CORRELATION_PREFIX,
    ],
    [
      'occurredFrom',
      { occurredFrom: '2026-08-13T00:00:00.000Z' },
      (row: SeedRow): boolean =>
        row.occurredAt >= new Date('2026-08-13T00:00:00.000Z'),
    ],
    [
      'occurredTo',
      { occurredTo: '2026-08-11T00:00:00.000Z' },
      (row: SeedRow): boolean =>
        row.occurredAt <= new Date('2026-08-11T00:00:00.000Z'),
    ],
  ] as const)(
    'filters by %s without leaking rows outside the criteria',
    async (_label, filter, predicate) => {
      const page = await service.listAdmin({
        page: 1,
        pageSize: 20,
        sortBy: 'occurredAt',
        sortOrder: 'desc',
        correlationId: CORRELATION_PREFIX,
        ...filter,
      });
      const expected = scopedRows().filter(predicate);
      expect(page.meta.total).toBe(expected.length);
      expect(page.data).toHaveLength(expected.length);
      expect(page.data.every((row) => predicate(row as SeedRow))).toBe(true);
    },
  );

  it('combines representative operator filters (action + actor + entity)', async () => {
    const page = await service.listAdmin({
      page: 1,
      pageSize: 20,
      sortBy: 'occurredAt',
      sortOrder: 'desc',
      action: AuditAction.ORDER_CONFIRMED,
      actorType: AuditActorType.ADMIN,
      actorId: actorAdminId,
      entityType: AuditEntityType.ORDER,
      entityId: entityOrderA,
      requestId: 'req_aud03_b',
      correlationId: CORRELATION_PREFIX,
    });
    expect(page.meta.total).toBe(1);
    expect(page.data[0]?.id).toBe('a0000002-0000-4000-8000-000000000002');
  });

  it('maps only allowlisted filters into repository WHERE construction', async () => {
    const findMany = jest.spyOn(prisma.auditLog, 'findMany');
    await service.listAdmin({
      page: 1,
      pageSize: 10,
      sortBy: 'occurredAt',
      sortOrder: 'desc',
      action: AuditAction.ORDER_CREATED,
      entityId: entityOrderA,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          action: AuditAction.ORDER_CREATED,
          entityId: entityOrderA,
        },
      }),
    );
    findMany.mockRestore();
  });

  it('returns an exact detail record and a stable not-found error', async () => {
    const detail = await service.getAdminById(
      'a0000010-0000-4000-8000-000000000010',
    );
    expect(detail).toMatchObject({
      id: 'a0000010-0000-4000-8000-000000000010',
      action: AuditAction.PRICE_CHANGED,
      entityId: entityProduct,
      metadata: { previousPrice: 1000, newPrice: 1200 },
    });

    await expect(
      service.getAdminById('f0000000-0000-4000-8000-000000000099'),
    ).rejects.toBeInstanceOf(AuditLogNotFoundError);
  });

  it('omits metadata on list items and exposes bounded metadata on detail DTOs', async () => {
    const listItem = toAdminAuditLogListItemDto(
      (await repository.findById('a0000010-0000-4000-8000-000000000010'))!,
    );
    expect(listItem).not.toHaveProperty('metadata');
    expect(Object.keys(listItem).sort()).toEqual(
      [
        'action',
        'actorId',
        'actorType',
        'correlationId',
        'entityId',
        'entityType',
        'id',
        'occurredAt',
        'requestId',
      ].sort(),
    );

    const detailDto = toAdminAuditLogDetailDto(
      await service.getAdminById('a0000010-0000-4000-8000-000000000010'),
    );
    expect(detailDto.metadata).toEqual({ previousPrice: 1000, newPrice: 1200 });
    expect(detailDto).not.toHaveProperty('createdAt');
    expect(detailDto).not.toHaveProperty('updatedAt');
  });

  it('does not append audit rows when listing or reading detail', async () => {
    const before = await prisma.auditLog.count({
      where: { correlationId: { startsWith: CORRELATION_PREFIX } },
    });
    expect(before).toBe(5);

    await service.listAdmin({
      page: 1,
      pageSize: 20,
      sortBy: 'occurredAt',
      sortOrder: 'desc',
      correlationId: CORRELATION_PREFIX,
    });
    await service.getAdminById('a0000002-0000-4000-8000-000000000002');

    const after = await prisma.auditLog.count({
      where: { correlationId: { startsWith: CORRELATION_PREFIX } },
    });
    expect(after).toBe(before);
    const viewed = await prisma.auditLog.count({
      where: { action: { contains: 'viewed' } },
    });
    expect(viewed).toBe(0);
  });

  it('runs EXPLAIN on representative read access patterns', async () => {
    const explain = async (query: string): Promise<ExplainRow> => {
      const rows = await prisma.$queryRawUnsafe<ExplainRow[]>(
        `EXPLAIN (FORMAT JSON) ${query}`,
      );
      return rows[0]!;
    };

    const collectNodeTypes = (
      plan: ExplainRow['QUERY PLAN'][0]['Plan'],
    ): string[] => {
      const nodes = [plan['Node Type']];
      for (const child of plan.Plans ?? []) {
        nodes.push(
          ...collectNodeTypes(child as ExplainRow['QUERY PLAN'][0]['Plan']),
        );
      }
      return nodes;
    };

    const plans = await Promise.all([
      explain(
        'SELECT "id", "occurredAt", "actorType", "actorId", "action", "entityType", "entityId", "requestId", "correlationId" FROM "AuditLog" ORDER BY "occurredAt" DESC, "id" DESC LIMIT 20',
      ),
      explain(
        `SELECT "id", "occurredAt" FROM "AuditLog" WHERE "action" = '${AuditAction.ORDER_CREATED}' ORDER BY "occurredAt" DESC, "id" DESC LIMIT 20`,
      ),
      explain(
        `SELECT "id", "occurredAt" FROM "AuditLog" WHERE "actorType" = '${AuditActorType.ADMIN}' AND "actorId" = '${actorAdminId}'::uuid ORDER BY "occurredAt" DESC, "id" DESC LIMIT 20`,
      ),
      explain(
        `SELECT "id", "occurredAt" FROM "AuditLog" WHERE "entityType" = '${AuditEntityType.ORDER}' AND "entityId" = '${entityOrderA}'::uuid ORDER BY "occurredAt" DESC, "id" DESC LIMIT 20`,
      ),
      explain(
        `SELECT "id", "occurredAt", "metadata" FROM "AuditLog" WHERE "id" = 'a0000002-0000-4000-8000-000000000002'::uuid`,
      ),
    ]);

    for (const row of plans) {
      const nodeTypes = collectNodeTypes(row['QUERY PLAN'][0]!.Plan);
      expect(nodeTypes.length).toBeGreaterThan(0);
      expect(nodeTypes).toContain('Seq Scan');
    }

    const indexDefs = await prisma.$queryRawUnsafe<
      Array<{ indexname: string }>
    >(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'AuditLog' AND schemaname = 'public'",
    );
    expect(indexDefs.map((row) => row.indexname).sort()).toEqual(
      [
        'AuditLog_action_occurredAt_id_idx',
        'AuditLog_actorType_actorId_occurredAt_id_idx',
        'AuditLog_correlationId_occurredAt_id_idx',
        'AuditLog_entityType_entityId_occurredAt_id_idx',
        'AuditLog_occurredAt_id_idx',
        'AuditLog_pkey',
        'AuditLog_requestId_occurredAt_id_idx',
      ].sort(),
    );
  });
});

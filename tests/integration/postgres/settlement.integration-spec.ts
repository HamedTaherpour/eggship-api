import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { Prisma } from '../../../src/generated/prisma/client';
import { PrismaModule } from '../../../src/infrastructure/database/prisma/prisma.module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { TransactionRunner } from '../../../src/infrastructure/database/transaction';
import { InMemoryStorageProvider } from '../../../src/infrastructure/storage/in-memory-storage.provider';
import { STORAGE_PROVIDER } from '../../../src/infrastructure/storage/storage.tokens';
import {
  MEDIA_UPLOAD_LIMITS,
  MediaService,
} from '../../../src/modules/media/application/media.service';
import { MediaReferencedError } from '../../../src/modules/media/domain/media-errors';
import { pngFixture } from '../../../src/modules/media/domain/media-test-fixtures';
import { MediaRepository } from '../../../src/modules/media/infrastructure/media.repository';
import { OrderStatus } from '../../../src/modules/orders/domain/order-status';
import { SettlementService } from '../../../src/modules/settlements/application/settlement.service';
import { SettlementStatus } from '../../../src/modules/settlements/domain/settlement';
import {
  SettlementAlreadyExistsError,
  SettlementInvalidTransitionError,
} from '../../../src/modules/settlements/domain/settlement-errors';
import { SettlementRepository } from '../../../src/modules/settlements/infrastructure/settlement.repository';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';
import { AuditModule } from '../../../src/modules/audit/audit.module';
import { AuditLogService } from '../../../src/modules/audit/application/audit-log.service';
import { AuditAction } from '../../../src/modules/audit/domain/audit-event';

async function truncateSettlementTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "OrderSettlement", "OrderLine", "Order", "Media", "Region", "User", "Admin" RESTART IDENTITY CASCADE',
  );
}

describe('Deferred settlement persistence and concurrency (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let service: SettlementService;
  let repository: SettlementRepository;
  let transactions: TransactionRunner;
  let mediaService: MediaService;
  let mediaRepository: MediaRepository;
  let storage: InMemoryStorageProvider;
  let audit: AuditLogService;

  beforeAll(async () => {
    storage = new InMemoryStorageProvider('https://media.test.invalid');
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        PrismaModule,
        AuditModule,
      ],
      providers: [
        SettlementRepository,
        SettlementService,
        MediaRepository,
        MediaService,
        { provide: STORAGE_PROVIDER, useValue: storage },
        {
          provide: MEDIA_UPLOAD_LIMITS,
          useValue: {
            maxFileBytes: 5_242_880,
            maxFilesPerBatch: 10,
            maxBatchBytes: 26_214_400,
            uploadConcurrency: 3,
          },
        },
      ],
    }).compile();
    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(SettlementService);
    repository = moduleRef.get(SettlementRepository);
    transactions = moduleRef.get(TransactionRunner);
    mediaService = moduleRef.get(MediaService);
    mediaRepository = moduleRef.get(MediaRepository);
    audit = moduleRef.get(AuditLogService);
    await app.init();
  });

  beforeEach(async () => {
    await truncateSettlementTables(prisma);
    storage.clearForTest();
  });

  afterAll(async () => app.close());

  async function seed(
    status: OrderStatus = OrderStatus.DELIVERED,
  ): Promise<{ orderId: string; adminId: string }> {
    const admin = await prisma.admin.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        passwordHash: 'synthetic-integration-hash',
        role: 'SUPER_ADMIN',
      },
    });
    const user = await prisma.user.create({
      data: {
        phone: `+989${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0')}`,
      },
    });
    const region = await prisma.region.create({
      data: { name: `Region ${randomUUID()}` },
    });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        regionId: region.id,
        regionName: region.name,
        status,
        customerPhone: user.phone,
        grossSubtotal: 10_000n,
        lineDiscountTotal: 0n,
        subtotalAfterLineDiscounts: 10_000n,
        orderDiscountAmount: 0n,
        total: 10_000n,
        pricingEvaluatedAt: new Date(),
        deliveredAt: status === OrderStatus.DELIVERED ? new Date() : null,
      },
    });
    return { orderId: order.id, adminId: admin.id };
  }

  async function createMedia(name = 'receipt.png'): Promise<string> {
    const row = await mediaRepository.create({
      storageKey: `media/2026/08/${randomUUID()}.png`,
      originalFileName: name,
      mimeType: 'image/png',
      sizeBytes: 16,
      width: 1,
      height: 1,
      accessClass: 'ADMIN_ONLY',
    });
    return row.id;
  }

  it('enforces delivered-only creation and exactly one settlement under a stampede', async () => {
    const { orderId, adminId } = await seed();
    const outcomes = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        service.create(orderId, '2026-08-01T00:00:00.000Z', adminId),
      ),
    );
    expect(outcomes.filter((row) => row.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(
      outcomes
        .filter((row) => row.status === 'rejected')
        .every((row) => row.reason instanceof SettlementAlreadyExistsError),
    ).toBe(true);
    expect(await prisma.orderSettlement.count({ where: { orderId } })).toBe(1);

    const undelivered = await seed(OrderStatus.SHIPPED);
    await expect(
      service.create(
        undelivered.orderId,
        '2026-08-01T00:00:00.000Z',
        undelivered.adminId,
      ),
    ).rejects.toMatchObject({ code: 'SETTLEMENT_ORDER_NOT_DELIVERED' });
  });

  it('enforces UNIQUE, RESTRICT foreign keys, and lifecycle/provenance CHECK constraints', async () => {
    const { orderId, adminId } = await seed();
    const created = await service.create(
      orderId,
      '2026-08-01T00:00:00.000Z',
      adminId,
    );
    await expect(
      prisma.orderSettlement.create({
        data: { orderId, dueAt: new Date(), createdByAdminId: adminId },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.order.delete({ where: { id: orderId } }),
    ).rejects.toThrow();
    await expect(
      prisma.admin.delete({ where: { id: adminId } }),
    ).rejects.toThrow();

    await expect(
      prisma.$executeRaw(Prisma.sql`
      UPDATE "OrderSettlement"
      SET "receiptMediaId" = ${randomUUID()}::uuid
      WHERE "id" = ${created.id}::uuid
    `),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw(Prisma.sql`
      UPDATE "OrderSettlement"
      SET "status" = 'SETTLED'::"OrderSettlementStatus"
      WHERE "id" = ${created.id}::uuid
    `),
    ).rejects.toThrow();
  });

  it('keeps concurrent due-date writes coherent', async () => {
    const { orderId, adminId } = await seed();
    const created = await service.create(
      orderId,
      '2026-08-01T00:00:00.000Z',
      adminId,
    );
    const candidates = ['2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'];
    const outcomes = await Promise.all(
      candidates.map((dueAt) =>
        service.changeDueAt(created.id, dueAt, adminId),
      ),
    );
    const final = await repository.findById(created.id);
    expect(candidates).toContain(final!.dueAt.toISOString());
    expect(
      outcomes.every((row) => candidates.includes(row.dueAt.toISOString())),
    ).toBe(true);
  });

  it('atomically replaces receipt/provenance and makes same-Media replay idempotent', async () => {
    const { orderId, adminId } = await seed();
    const secondAdmin = await prisma.admin.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        passwordHash: 'synthetic-integration-hash',
        role: 'SUPER_ADMIN',
      },
    });
    const created = await service.create(
      orderId,
      '2026-08-01T00:00:00.000Z',
      adminId,
    );
    const mediaIds = await Promise.all([
      createMedia('a.png'),
      createMedia('b.png'),
    ]);
    await Promise.all([
      service.attachReceipt(created.id, mediaIds[0], adminId),
      service.attachReceipt(created.id, mediaIds[1], secondAdmin.id),
    ]);
    const final = await repository.findById(created.id);
    const expectedActor =
      final!.receiptMediaId === mediaIds[0] ? adminId : secondAdmin.id;
    expect(final).toMatchObject({
      status: SettlementStatus.OPEN,
      receiptAttachedByAdminId: expectedActor,
    });
    expect(
      await prisma.auditLog.count({
        where: { action: AuditAction.SETTLEMENT_UPDATED, entityId: created.id },
      }),
    ).toBe(2);
    expect(final!.receiptAttachedAt).not.toBeNull();
    const timestamp = final!.receiptAttachedAt;
    await service.attachReceipt(created.id, final!.receiptMediaId!, adminId);
    expect((await repository.findById(created.id))!.receiptAttachedAt).toEqual(
      timestamp,
    );
  });

  it('settles once under a stampede and preserves the winning timestamp/actor on replay', async () => {
    const { orderId, adminId } = await seed();
    const secondAdmin = await prisma.admin.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        passwordHash: 'synthetic-integration-hash',
        role: 'SUPER_ADMIN',
      },
    });
    const created = await service.create(
      orderId,
      '2026-08-01T00:00:00.000Z',
      adminId,
    );
    await service.attachReceipt(created.id, await createMedia(), adminId);
    const outcomes = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        service.markSettled(
          created.id,
          index % 2 === 0 ? adminId : secondAdmin.id,
        ),
      ),
    );
    expect(
      new Set(outcomes.map((row) => row.settledAt!.toISOString())).size,
    ).toBe(1);
    expect(new Set(outcomes.map((row) => row.settledByAdminId)).size).toBe(1);
    const first = outcomes[0]!;
    const replay = await service.markSettled(
      created.id,
      first.settledByAdminId === adminId ? secondAdmin.id : adminId,
    );
    expect(replay.settledAt).toEqual(first.settledAt);
    expect(replay.settledByAdminId).toBe(first.settledByAdminId);
    expect(
      await prisma.auditLog.count({
        where: { action: AuditAction.SETTLEMENT_SETTLED, entityId: created.id },
      }),
    ).toBe(1);
    await expect(
      service.changeDueAt(created.id, '2027-01-01T00:00:00.000Z', adminId),
    ).rejects.toBeInstanceOf(SettlementInvalidTransitionError);
  });

  it('serializes receipt replacement versus settle without partial provenance', async () => {
    const { orderId, adminId } = await seed();
    const created = await service.create(
      orderId,
      '2026-08-01T00:00:00.000Z',
      adminId,
    );
    const firstMedia = await createMedia('first.png');
    const secondMedia = await createMedia('second.png');
    await service.attachReceipt(created.id, firstMedia, adminId);
    await Promise.allSettled([
      service.attachReceipt(created.id, secondMedia, adminId),
      service.markSettled(created.id, adminId),
    ]);
    const final = await repository.findById(created.id);
    expect(final!.status).toBe(SettlementStatus.SETTLED);
    expect([firstMedia, secondMedia]).toContain(final!.receiptMediaId);
    expect(final!.receiptAttachedAt).not.toBeNull();
    expect(final!.receiptAttachedByAdminId).toBe(adminId);
    expect(final!.settledAt).not.toBeNull();
  });

  it('rolls back receipt changes and blocks referenced Media deletion before object removal', async () => {
    const { orderId, adminId } = await seed();
    const created = await service.create(
      orderId,
      '2026-08-01T00:00:00.000Z',
      adminId,
    );
    const upload = await mediaService.uploadBatch(
      [
        {
          originalName: 'proof.png',
          claimedMimeType: 'image/png',
          size: pngFixture().length,
          buffer: pngFixture(),
        },
      ],
      'ADMIN_ONLY',
    );
    const item = upload.items[0];
    if (item === undefined || item.status !== 'uploaded')
      throw new Error('Expected uploaded receipt.');

    await expect(
      transactions.run(async (tx) => {
        await repository.attachReceipt(created.id, item.media.id, adminId, tx);
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');
    expect((await repository.findById(created.id))!.receiptMediaId).toBeNull();

    await service.attachReceipt(created.id, item.media.id, adminId);
    await expect(
      mediaService.deleteAdmin(item.media.id, adminId),
    ).rejects.toBeInstanceOf(MediaReferencedError);
    expect(await mediaRepository.findById(item.media.id)).not.toBeNull();
    expect(await storage.exists(item.media.storageKey)).toBe(true);
    await expect(
      prisma.media.delete({ where: { id: item.media.id } }),
    ).rejects.toThrow();
  });

  it('derives overdue at read time and remains independent when Order becomes RETURNED', async () => {
    const { orderId, adminId } = await seed();
    const open = await service.create(
      orderId,
      '2020-01-01T00:00:00.000Z',
      adminId,
    );
    const overdue = await service.listAdmin({
      page: 1,
      pageSize: 20,
      overdue: true,
      sortBy: 'dueAt',
      sortOrder: 'asc',
    });
    expect(overdue.data.map((row) => row.id)).toContain(open.id);
    const notOverdue = await service.listAdmin({
      page: 1,
      pageSize: 20,
      overdue: false,
      sortBy: 'dueAt',
      sortOrder: 'asc',
    });
    expect(notOverdue.data.map((row) => row.id)).not.toContain(open.id);

    await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.RETURNED },
    });
    expect(await repository.findById(open.id)).toMatchObject({
      status: SettlementStatus.OPEN,
      orderStatus: OrderStatus.RETURNED,
    });
  });

  it('rolls back settlement due-date mutation when required audit append fails', async () => {
    const { orderId, adminId } = await seed();
    const created = await service.create(
      orderId,
      '2026-08-01T00:00:00.000Z',
      adminId,
    );
    jest
      .spyOn(audit, 'append')
      .mockRejectedValueOnce(new Error('audit failure'));
    await expect(
      service.changeDueAt(created.id, '2026-09-01T00:00:00.000Z', adminId),
    ).rejects.toThrow('audit failure');
    expect((await repository.findById(created.id))!.dueAt.toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
    expect(
      await prisma.auditLog.count({
        where: { action: AuditAction.SETTLEMENT_UPDATED, entityId: created.id },
      }),
    ).toBe(0);
    jest.restoreAllMocks();
  });
});

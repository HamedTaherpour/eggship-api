import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdminRole } from '../../../src/common/authz/admin-role';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { CommercePolicyService } from '../../../src/modules/commerce-policy/application/commerce-policy.service';
import { CommercePolicyModule } from '../../../src/modules/commerce-policy/commerce-policy.module';
import { CommerceOverrideMode } from '../../../src/modules/commerce-policy/domain/commerce-policy';
import {
  CommerceOverrideNotFoundError,
  CommercePolicyRevisionConflictError,
} from '../../../src/modules/commerce-policy/domain/commerce-policy-errors';
import { CommercePolicyRepository } from '../../../src/modules/commerce-policy/infrastructure/commerce-policy.repository';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';
import { postgresIntegrationImports } from '../support/postgres-testing-module';

describe('Commerce policy persistence (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let service: CommercePolicyService;
  let repository: CommercePolicyRepository;
  let adminId: string;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [...postgresIntegrationImports([CommercePolicyModule])],
    }).compile();
    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(CommercePolicyService);
    repository = moduleRef.get(CommercePolicyRepository);
    await app.init();
  });
  beforeEach(async () => {
    assertDestructiveOperationsAllowed();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "CommerceScheduleOverride", "CommerceSettings" RESTART IDENTITY CASCADE',
    );
    const admin = await prisma.admin.upsert({
      where: { email: 'commerce-integration@example.test' },
      update: { isActive: true, role: AdminRole.SUPER_ADMIN },
      create: {
        email: 'commerce-integration@example.test',
        passwordHash: 'integration-placeholder-hash',
        role: AdminRole.SUPER_ADMIN,
      },
    });
    adminId = admin.id;
  });
  afterAll(async () => app.close());

  const initial = {
    orderingScheduleEnabled: true,
    orderingOpensAtLocalMinute: 420,
    orderingClosesAtLocalMinute: 960,
    minimumOrderQuantity: 5,
  };

  it('leaves the singleton absent, initializes revision 1, and enforces singleton/check constraints', async () => {
    await expect(service.getSettings()).resolves.toBeNull();
    const created = await service.initialize(initial, 0, adminId);
    expect(created.revision).toBe(1);
    await expect(
      prisma.commerceSettings.create({
        data: {
          id: 2,
          ...initial,
          revision: 1,
          createdByAdminId: adminId,
          updatedByAdminId: adminId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.commerceSettings.update({
        where: { id: 1 },
        data: { orderingOpensAtLocalMinute: 960 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.commerceSettings.update({
        where: { id: 1 },
        data: { minimumOrderQuantity: 0 },
      }),
    ).rejects.toThrow();
  });

  it('allows one concurrent expected-revision settings writer and rolls the loser back', async () => {
    await service.initialize(initial, 0, adminId);
    const writes = await Promise.allSettled([
      service.update({ ...initial, minimumOrderQuantity: 6 }, 1, adminId),
      service.update({ ...initial, minimumOrderQuantity: 7 }, 1, adminId),
    ]);
    expect(
      writes.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = writes.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected?.reason).toBeInstanceOf(
      CommercePolicyRevisionConflictError,
    );
    const current = await service.getSettings();
    expect(current?.revision).toBe(2);
    expect([6, 7]).toContain(current?.minimumOrderQuantity);
  });

  it('creates/updates/removes overrides with one atomic global revision increment', async () => {
    await service.initialize(initial, 0, adminId);
    const created = await service.putOverride(
      '2026-08-25',
      {
        mode: CommerceOverrideMode.CLOSED,
        opensAtLocalMinute: null,
        closesAtLocalMinute: null,
      },
      1,
      adminId,
    );
    expect(created.settings.revision).toBe(2);
    const updated = await service.putOverride(
      '2026-08-25',
      {
        mode: CommerceOverrideMode.SPECIAL_HOURS,
        opensAtLocalMinute: 1080,
        closesAtLocalMinute: 120,
      },
      2,
      adminId,
    );
    expect(updated.settings.revision).toBe(3);
    const removed = await service.removeOverride('2026-08-25', 3, adminId);
    expect(removed.settings.revision).toBe(4);
    expect(await prisma.commerceScheduleOverride.count()).toBe(0);
  });

  it('enforces unique local dates and CLOSED/SPECIAL_HOURS database shapes', async () => {
    await service.initialize(initial, 0, adminId);
    const date = new Date('2026-08-25T00:00:00.000Z');
    await prisma.commerceScheduleOverride.create({
      data: {
        localDate: date,
        mode: CommerceOverrideMode.CLOSED,
        createdByAdminId: adminId,
        updatedByAdminId: adminId,
      },
    });
    await expect(
      prisma.commerceScheduleOverride.create({
        data: {
          localDate: date,
          mode: CommerceOverrideMode.CLOSED,
          createdByAdminId: adminId,
          updatedByAdminId: adminId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.commerceScheduleOverride.create({
        data: {
          localDate: new Date('2026-08-26T00:00:00.000Z'),
          mode: CommerceOverrideMode.CLOSED,
          opensAtLocalMinute: 1,
          createdByAdminId: adminId,
          updatedByAdminId: adminId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.commerceScheduleOverride.create({
        data: {
          localDate: new Date('2026-08-27T00:00:00.000Z'),
          mode: CommerceOverrideMode.SPECIAL_HOURS,
          opensAtLocalMinute: 60,
          closesAtLocalMinute: 60,
          createdByAdminId: adminId,
          updatedByAdminId: adminId,
        },
      }),
    ).rejects.toThrow();
  });

  it('rolls back the revision when an override write fails and does not increment for failed removal', async () => {
    await service.initialize(initial, 0, adminId);
    await expect(
      repository.putOverride(
        '2026-08-25',
        {
          mode: CommerceOverrideMode.SPECIAL_HOURS,
          opensAtLocalMinute: 60,
          closesAtLocalMinute: 60,
        },
        1,
        adminId,
      ),
    ).rejects.toThrow();
    expect((await service.getSettings())?.revision).toBe(1);
    await expect(
      service.removeOverride('2026-08-25', 1, adminId),
    ).rejects.toBeInstanceOf(CommerceOverrideNotFoundError);
    expect((await service.getSettings())?.revision).toBe(1);
  });

  it('elects one winner for concurrent initialization', async () => {
    const otherAdmin = await prisma.admin.create({
      data: {
        email: `commerce-${randomUUID()}@example.test`,
        passwordHash: 'integration-placeholder-hash',
        role: AdminRole.SUPER_ADMIN,
      },
    });
    const results = await Promise.allSettled([
      service.initialize(initial, 0, adminId),
      service.initialize(initial, 0, otherAdmin.id),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect((await service.getSettings())?.revision).toBe(1);
  });
});

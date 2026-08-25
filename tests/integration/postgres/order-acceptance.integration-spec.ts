import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdminRole } from '../../../src/common/authz/admin-role';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { TransactionRunner } from '../../../src/infrastructure/database/transaction';
import { CommercePolicyService } from '../../../src/modules/commerce-policy/application/commerce-policy.service';
import { CommercePolicyModule } from '../../../src/modules/commerce-policy/commerce-policy.module';
import {
  CommerceOverrideMode,
  type CommerceSettingsInput,
} from '../../../src/modules/commerce-policy/domain/commerce-policy';
import {
  previousLocalDate,
  toTehranLocalWallClock,
} from '../../../src/modules/commerce-policy/domain/order-acceptance';
import { CommercePolicyRepository } from '../../../src/modules/commerce-policy/infrastructure/commerce-policy.repository';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';
import { postgresIntegrationImports } from '../support/postgres-testing-module';

const OPEN_ALWAYS: CommerceSettingsInput = {
  orderingScheduleEnabled: false,
  orderingOpensAtLocalMinute: 7 * 60,
  orderingClosesAtLocalMinute: 16 * 60,
  minimumOrderQuantity: 1,
};

describe('Order acceptance policy snapshot (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let service: CommercePolicyService;
  let repository: CommercePolicyRepository;
  let transactions: TransactionRunner;
  let adminId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [...postgresIntegrationImports([CommercePolicyModule])],
    }).compile();
    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(CommercePolicyService);
    repository = moduleRef.get(CommercePolicyRepository);
    transactions = moduleRef.get(TransactionRunner);
    await app.init();
  });

  beforeEach(async () => {
    assertDestructiveOperationsAllowed();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "CommerceScheduleOverride", "CommerceSettings" RESTART IDENTITY CASCADE',
    );
    const admin = await prisma.admin.upsert({
      where: { email: 'order-acceptance-integration@example.test' },
      update: { isActive: true, role: AdminRole.SUPER_ADMIN },
      create: {
        email: 'order-acceptance-integration@example.test',
        passwordHash: 'integration-placeholder-hash',
        role: AdminRole.SUPER_ADMIN,
      },
    });
    adminId = admin.id;
    await service.initialize(OPEN_ALWAYS, 0, adminId);
  });

  afterAll(async () => {
    await app.close();
  });

  it('observes one coherent settings revision under concurrent Admin update', async () => {
    const observed = await transactions.runRepeatableRead(async (tx) => {
      const first = await service.evaluateOrderAcceptance(
        [{ quantity: 1 }],
        tx,
      );

      await service.update(
        { ...OPEN_ALWAYS, minimumOrderQuantity: 9 },
        1,
        adminId,
      );

      const second = await service.evaluateOrderAcceptance(
        [{ quantity: 1 }],
        tx,
      );
      return { first, second };
    });

    expect(observed.first.revision).toBe(1);
    expect(observed.second.revision).toBe(1);
    expect(observed.first.minimumOrderQuantity).toBe(1);
    expect(observed.second.minimumOrderQuantity).toBe(1);

    const after = await service.getSettings();
    expect(after?.revision).toBe(2);
    expect(after?.minimumOrderQuantity).toBe(9);
  });

  it('observes one coherent regular schedule under concurrent Admin update', async () => {
    await service.update(
      {
        orderingScheduleEnabled: true,
        orderingOpensAtLocalMinute: 0,
        orderingClosesAtLocalMinute: 24 * 60 - 1,
        minimumOrderQuantity: 1,
      },
      1,
      adminId,
    );

    const observed = await transactions.runRepeatableRead(async (tx) => {
      const first = await repository.getSettings(tx);
      await service.update(
        {
          orderingScheduleEnabled: true,
          orderingOpensAtLocalMinute: 0,
          orderingClosesAtLocalMinute: 1,
          minimumOrderQuantity: 1,
        },
        2,
        adminId,
      );
      const second = await repository.getSettings(tx);
      return { first, second };
    });

    expect(observed.first?.revision).toBe(2);
    expect(observed.second?.revision).toBe(2);
    expect(observed.first?.orderingClosesAtLocalMinute).toBe(24 * 60 - 1);
    expect(observed.second?.orderingClosesAtLocalMinute).toBe(24 * 60 - 1);

    const after = await service.getSettings();
    expect(after?.revision).toBe(3);
    expect(after?.orderingClosesAtLocalMinute).toBe(1);
  });

  it('observes one coherent override set under concurrent Admin override mutation', async () => {
    const observed = await transactions.runRepeatableRead(async (tx) => {
      const evaluatedAt = await repository.readEvaluationInstant(tx);
      const { localDate } = toTehranLocalWallClock(evaluatedAt);
      const preceding = previousLocalDate(localDate);

      const before = await repository.findOverridesForLocalDates(
        [localDate, preceding],
        tx,
      );

      await service.putOverride(
        localDate,
        {
          mode: CommerceOverrideMode.CLOSED,
          opensAtLocalMinute: null,
          closesAtLocalMinute: null,
        },
        1,
        adminId,
      );

      const afterInTx = await repository.findOverridesForLocalDates(
        [localDate, preceding],
        tx,
      );
      const settingsInTx = await repository.getSettings(tx);
      return { before, afterInTx, settingsInTx, localDate };
    });

    expect(observed.before).toHaveLength(0);
    expect(observed.afterInTx).toHaveLength(0);
    expect(observed.settingsInTx?.revision).toBe(1);

    const afterCommit = await service.listOverrides(
      observed.localDate,
      observed.localDate,
    );
    expect(afterCommit).toHaveLength(1);
    expect(afterCommit[0]?.mode).toBe(CommerceOverrideMode.CLOSED);
    expect((await service.getSettings())?.revision).toBe(2);
  });

  it('never mixes settings and override revisions across a concurrent Admin write', async () => {
    const { localDate } = toTehranLocalWallClock(new Date());

    const observed = await transactions.runRepeatableRead(async (tx) => {
      const firstSettings = await repository.getSettings(tx);
      const firstOverrides = await repository.findOverridesForLocalDates(
        [localDate],
        tx,
      );

      await service.update(
        { ...OPEN_ALWAYS, minimumOrderQuantity: 7 },
        1,
        adminId,
      );
      await service.putOverride(
        localDate,
        {
          mode: CommerceOverrideMode.SPECIAL_HOURS,
          opensAtLocalMinute: 10 * 60,
          closesAtLocalMinute: 12 * 60,
        },
        2,
        adminId,
      );

      const secondSettings = await repository.getSettings(tx);
      const secondOverrides = await repository.findOverridesForLocalDates(
        [localDate],
        tx,
      );
      return {
        firstSettings,
        firstOverrides,
        secondSettings,
        secondOverrides,
      };
    });

    expect(observed.firstSettings?.revision).toBe(1);
    expect(observed.secondSettings?.revision).toBe(1);
    expect(observed.firstSettings?.minimumOrderQuantity).toBe(1);
    expect(observed.secondSettings?.minimumOrderQuantity).toBe(1);
    expect(observed.firstOverrides).toHaveLength(0);
    expect(observed.secondOverrides).toHaveLength(0);

    const committed = await service.getSettings();
    expect(committed?.revision).toBe(3);
    expect(committed?.minimumOrderQuantity).toBe(7);
    expect((await service.listOverrides(localDate, localDate))[0]?.mode).toBe(
      CommerceOverrideMode.SPECIAL_HOURS,
    );
  });

  it('evaluates prior-date SPECIAL_HOURS carry and current-date CLOSED truncation on one snapshot', async () => {
    const evaluatedAt = await transactions.runRepeatableRead((tx) =>
      repository.readEvaluationInstant(tx),
    );
    const { localDate, localMinute } = toTehranLocalWallClock(evaluatedAt);
    const preceding = previousLocalDate(localDate);

    // Regular daytime window so early/late minutes are closed without overrides.
    await service.update(
      {
        orderingScheduleEnabled: true,
        orderingOpensAtLocalMinute: 7 * 60,
        orderingClosesAtLocalMinute: 16 * 60,
        minimumOrderQuantity: 1,
      },
      1,
      adminId,
    );

    await service.putOverride(
      preceding,
      {
        mode: CommerceOverrideMode.SPECIAL_HOURS,
        opensAtLocalMinute: 18 * 60,
        closesAtLocalMinute: 2 * 60,
      },
      2,
      adminId,
    );

    if (localMinute < 2 * 60) {
      await expect(
        transactions.runRepeatableRead((tx) =>
          service.evaluateOrderAcceptance([{ quantity: 1 }], tx),
        ),
      ).resolves.toMatchObject({ revision: 3, localDate });
    } else if (localMinute >= 7 * 60 && localMinute < 16 * 60) {
      await expect(
        transactions.runRepeatableRead((tx) =>
          service.evaluateOrderAcceptance([{ quantity: 1 }], tx),
        ),
      ).resolves.toMatchObject({ revision: 3, localDate });
    } else {
      await expect(
        transactions.runRepeatableRead((tx) =>
          service.evaluateOrderAcceptance([{ quantity: 1 }], tx),
        ),
      ).rejects.toMatchObject({ code: 'ORDERING_CLOSED' });
    }

    await service.putOverride(
      localDate,
      {
        mode: CommerceOverrideMode.CLOSED,
        opensAtLocalMinute: null,
        closesAtLocalMinute: null,
      },
      3,
      adminId,
    );

    await expect(
      transactions.runRepeatableRead((tx) =>
        service.evaluateOrderAcceptance([{ quantity: 1 }], tx),
      ),
    ).rejects.toMatchObject({ code: 'ORDERING_CLOSED' });
  });
});

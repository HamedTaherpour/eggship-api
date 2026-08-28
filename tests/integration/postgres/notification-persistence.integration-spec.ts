import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { TransactionRunner } from '../../../src/infrastructure/database/transaction';
import { NotificationsModule } from '../../../src/modules/notifications/notifications.module';
import {
  type CreateNotificationInput,
  NotificationInvalidUserError,
  NotificationSource,
  NotificationType,
} from '../../../src/modules/notifications/domain/notification';
import { NotificationRepository } from '../../../src/modules/notifications/infrastructure/notification.repository';
import { UserRepository } from '../../../src/modules/users/infrastructure/user.repository';
import type { UserRecord } from '../../../src/modules/users/domain/user';
import { UsersModule } from '../../../src/modules/users/users.module';
import { postgresIntegrationImports } from '../support/postgres-testing-module';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

describe('Notification persistence (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let users: UserRepository;
  let notifications: NotificationRepository;
  let transactions: TransactionRunner;
  let phoneCounter = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: postgresIntegrationImports([UsersModule, NotificationsModule]),
    }).compile();
    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    users = moduleRef.get(UserRepository);
    notifications = moduleRef.get(NotificationRepository);
    transactions = moduleRef.get(TransactionRunner);
    await app.init();
  });

  beforeEach(async () => {
    assertDestructiveOperationsAllowed();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Notification", "User" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => app.close());

  async function user(): Promise<UserRecord> {
    phoneCounter += 1;
    return users.create({
      phone: `+98912${String(1000000 + phoneCounter).slice(-7)}`,
    });
  }

  function createInput(userId: string): CreateNotificationInput {
    return {
      userId,
      type: NotificationType.ORDER_STATUS,
      source: NotificationSource.ORDER_TRANSITION,
      title: 'Order updated',
      body: 'Your order is on its way.',
      payload: { orderId: userId, status: 'SHIPPED' },
    };
  }

  it('persists ownership and prevents cross-user lookup', async () => {
    const owner = await user();
    const other = await user();
    const created = await notifications.create(createInput(owner.id));

    expect(
      await notifications.findOwnedById(created.id, owner.id),
    ).toMatchObject({
      id: created.id,
      userId: owner.id,
      readAt: null,
    });
    await expect(
      notifications.findOwnedById(created.id, other.id),
    ).resolves.toBeNull();
  });

  it('keeps read transition idempotent', async () => {
    const owner = await user();
    const created = await notifications.create(createInput(owner.id));
    const first = await notifications.markReadForOwner(created.id, owner.id);
    const second = await notifications.markReadForOwner(created.id, owner.id);

    expect(first?.readAt).not.toBeNull();
    expect(second?.readAt).toEqual(first?.readAt);
  });

  it('lists and bulk-marks only the principal owner inbox', async () => {
    const owner = await user();
    const other = await user();
    const first = await notifications.create(createInput(owner.id));
    await notifications.create(createInput(owner.id));
    await notifications.create(createInput(other.id));

    expect(
      await notifications.listOwned(owner.id, { page: 1, pageSize: 1 }),
    ).toMatchObject({ total: 2, items: [{ id: first.id }] });
    expect(await notifications.countUnreadForOwner(owner.id)).toBe(2);
    expect(await notifications.markAllReadForOwner(owner.id)).toBe(2);
    expect(await notifications.countUnreadForOwner(owner.id)).toBe(0);
    expect(await notifications.countUnreadForOwner(other.id)).toBe(1);
  });

  it('rejects a notification for a missing user through the foreign key boundary', async () => {
    await expect(
      notifications.create(createInput('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')),
    ).rejects.toBeInstanceOf(NotificationInvalidUserError);
  });

  it('rolls back creation when the caller transaction rolls back', async () => {
    const owner = await user();
    await expect(
      transactions.run(async (tx) => {
        const created = await notifications.create(createInput(owner.id), tx);
        throw new Error(`rollback:${created.id}`);
      }),
    ).rejects.toThrow(/rollback:/);

    expect(
      await prisma.notification.count({ where: { userId: owner.id } }),
    ).toBe(0);
  });

  it('has both owner inbox indexes required by list and unread queries', async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'Notification'
    `;
    expect(indexes.map((index) => index.indexname)).toEqual(
      expect.arrayContaining([
        'Notification_userId_createdAt_id_idx',
        'Notification_userId_readAt_createdAt_id_idx',
      ]),
    );
  });
});

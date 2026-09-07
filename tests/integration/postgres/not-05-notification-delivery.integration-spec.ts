import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { NotificationsModule } from '../../../src/modules/notifications/notifications.module';
import { NotificationDeliveryRepository } from '../../../src/modules/notifications/infrastructure/notification-delivery.repository';
import { PushInstallationRepository } from '../../../src/modules/notifications/infrastructure/push-installation.repository';
import type { PushInstallationRecord } from '../../../src/modules/notifications/domain/push-installation';
import type { NotificationRecord } from '../../../src/modules/notifications/domain/notification';
import { postgresIntegrationImports } from '../support/postgres-testing-module';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

describe('NOT-05 notification delivery PostgreSQL proof (integration)', () => {
  let prisma: PrismaService;
  let deliveries: NotificationDeliveryRepository;
  let installations: PushInstallationRepository;
  const fixtureUsers: string[] = [];
  const fixtureNotifications: string[] = [];
  const fixtureInstallations: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: postgresIntegrationImports([NotificationsModule]),
    }).compile();
    prisma = moduleRef.get(PrismaService);
    deliveries = moduleRef.get(NotificationDeliveryRepository);
    installations = moduleRef.get(PushInstallationRepository);
    await moduleRef.init();
  });

  beforeEach(() => {
    assertDestructiveOperationsAllowed();
  });

  afterEach(async () => {
    await prisma.notificationDelivery.deleteMany({
      where: {
        OR: [
          { installationId: { in: fixtureInstallations } },
          { notificationId: { in: fixtureNotifications } },
        ],
      },
    });
    await prisma.notification.deleteMany({
      where: { id: { in: fixtureNotifications } },
    });
    await prisma.pushInstallation.deleteMany({
      where: { id: { in: fixtureInstallations } },
    });
    await prisma.user.deleteMany({ where: { id: { in: fixtureUsers } } });
    fixtureUsers.length = 0;
    fixtureNotifications.length = 0;
    fixtureInstallations.length = 0;
  });

  afterAll(async () => prisma.$disconnect());

  it('materializes the initial snapshot once under concurrent processors', async () => {
    const user = await createUser();
    const rows = [];
    for (const suffix of ['a', 'b', 'c']) {
      rows.push(await register(user.id, `not05-${suffix}`));
    }
    const notification = await createNotification(user.id);

    await Promise.all(
      Array.from({ length: 2 }, () =>
        deliveries.materializeOnce(notification.id, user.id),
      ),
    );

    const persisted = await prisma.notificationDelivery.findMany({
      where: { notificationId: notification.id },
      orderBy: { installationId: 'asc' },
    });
    expect(persisted).toHaveLength(3);
    expect(new Set(persisted.map((row) => row.installationId))).toEqual(
      new Set(rows.map((row) => row.id)),
    );
    expect(
      (
        await prisma.notification.findUniqueOrThrow({
          where: { id: notification.id },
        })
      ).pushDeliveriesMaterializedAt,
    ).not.toBeNull();
  });

  it('keeps a historical recipient snapshot when a new installation registers later', async () => {
    const user = await createUser();
    await register(user.id, 'not05-historical-a');
    await register(user.id, 'not05-historical-b');
    const notification = await createNotification(user.id);
    await deliveries.materializeOnce(notification.id, user.id);
    const later = await register(user.id, 'not05-historical-d');

    await deliveries.materializeOnce(notification.id, user.id);

    const persisted = await prisma.notificationDelivery.findMany({
      where: { notificationId: notification.id },
    });
    expect(persisted).toHaveLength(2);
    expect(persisted.some((row) => row.installationId === later.id)).toBe(
      false,
    );
  });

  it('allows exactly one concurrent claim and increments attempts only for its winner', async () => {
    const fixture = await createDelivery();
    const results = await Promise.all(
      Array.from({ length: 2 }, () => deliveries.claim(fixture.deliveryId)),
    );
    const winners = results.filter((result) => result !== null);
    expect(winners).toHaveLength(1);
    expect(
      await prisma.notificationDelivery.findUniqueOrThrow({
        where: { id: fixture.deliveryId },
      }),
    ).toMatchObject({ state: 'SENDING', attemptCount: 1 });
  });

  it('blocks a fresh lease, reclaims a stale lease, and replaces ownership', async () => {
    const fixture = await createDelivery();
    const first = await deliveries.claim(fixture.deliveryId, 60);
    expect(first).not.toBeNull();
    expect(await deliveries.claim(fixture.deliveryId)).toBeNull();
    await prisma.notificationDelivery.update({
      where: { id: fixture.deliveryId },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });
    const second = await deliveries.claim(fixture.deliveryId);
    expect(second).not.toBeNull();
    expect(second?.claimToken).not.toBe(first?.claimToken);
    expect(
      await prisma.notificationDelivery.findUniqueOrThrow({
        where: { id: fixture.deliveryId },
      }),
    ).toMatchObject({
      state: 'SENDING',
      attemptCount: 2,
      claimToken: second?.claimToken,
    });
  });

  it('conditionally persists receipts and rejects stale workers and terminal overwrites', async () => {
    const fixture = await createDelivery();
    const claim = await deliveries.claim(fixture.deliveryId);
    expect(claim).not.toBeNull();
    expect(
      await deliveries.complete(
        fixture.deliveryId,
        '00000000-0000-4000-8000-000000000000',
        'ACCEPTED',
      ),
    ).toBe(false);
    expect(
      await deliveries.complete(
        fixture.deliveryId,
        claim!.claimToken,
        'ACCEPTED',
      ),
    ).toBe(true);
    expect(
      await deliveries.complete(
        fixture.deliveryId,
        claim!.claimToken,
        'FAILED',
        'TRANSIENT',
      ),
    ).toBe(false);
    await expect(
      prisma.notificationDelivery.findUniqueOrThrow({
        where: { id: fixture.deliveryId },
      }),
    ).resolves.toMatchObject({
      state: 'ACCEPTED',
      attemptCount: 1,
      claimToken: null,
    });
  });

  it('demonstrates at-least-once recovery after acceptance before durable persistence', async () => {
    const fixture = await createDelivery();
    const first = await deliveries.claim(fixture.deliveryId);
    expect(first).not.toBeNull();
    let providerInvocations = 1;
    // The external provider accepted the send, but the process crashed before
    // complete() persisted ACCEPTED. The durable row intentionally remains SENDING.
    await prisma.notificationDelivery.update({
      where: { id: fixture.deliveryId },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });
    const second = await deliveries.claim(fixture.deliveryId);
    providerInvocations += second === null ? 0 : 1;
    expect(second).not.toBeNull();
    expect(providerInvocations).toBe(2);
    expect(second?.claimToken).not.toBe(first?.claimToken);
    expect(
      await prisma.notificationDelivery.findUniqueOrThrow({
        where: { id: fixture.deliveryId },
      }),
    ).toMatchObject({ state: 'SENDING', attemptCount: 2 });
  });

  it('suppresses revoked or disabled recipients during the eligibility recheck', async () => {
    const user = await createUser();
    const installation = await register(user.id, 'not05-suppressed');
    const notification = await createNotification(user.id);
    await deliveries.materializeOnce(notification.id, user.id);
    await installations.revokeOwned(user.id, installation.installationId);
    expect(await deliveries.isEligible(installation.id)).toBe(false);
    const claim = await deliveries.claim(
      (
        await prisma.notificationDelivery.findFirstOrThrow({
          where: { notificationId: notification.id },
        })
      ).id,
    );
    expect(claim).toBeNull();
  });

  it('invalidates one installation without deleting it or affecting a sibling', async () => {
    const user = await createUser();
    const first = await register(user.id, 'not05-invalid-a');
    const second = await register(user.id, 'not05-invalid-b');
    await installations.invalidate(first.id);
    const persisted = await prisma.pushInstallation.findMany({
      where: { id: { in: [first.id, second.id] } },
    });
    expect(persisted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, status: 'INVALIDATED' }),
        expect.objectContaining({ id: second.id, status: 'ACTIVE' }),
      ]),
    );
  });

  it('enforces unique logical delivery identity and restrictive historical foreign keys', async () => {
    const fixture = await createDelivery();
    await expect(
      deliveries.createIfAbsent({
        notificationId: fixture.notificationId,
        installationId: fixture.installationId,
        channel: 'WEB_PUSH',
      }),
    ).resolves.toMatchObject({ id: fixture.deliveryId });
    await expect(
      prisma.notificationDelivery.create({
        data: {
          notificationId: randomUUID(),
          installationId: fixture.installationId,
          channel: 'WEB_PUSH',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.pushInstallation.delete({ where: { id: fixture.installationId } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  async function createDelivery(): Promise<{
    notificationId: string;
    installationId: string;
    deliveryId: string;
  }> {
    const user = await createUser();
    const installation = await register(user.id, `not05-token-${randomUUID()}`);
    const notification = await createNotification(user.id);
    await deliveries.materializeOnce(notification.id, user.id);
    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { notificationId: notification.id },
    });
    return {
      notificationId: notification.id,
      installationId: installation.id,
      deliveryId: delivery.id,
    };
  }

  async function createUser(): Promise<{ id: string }> {
    const user = await prisma.user.create({
      data: {
        phone: `+98913${String(1000000 + fixtureUsers.length).padStart(7, '0')}`,
      },
    });
    fixtureUsers.push(user.id);
    return user;
  }

  async function register(
    userId: string,
    providerToken: string,
  ): Promise<PushInstallationRecord> {
    const installationId = randomUUID();
    const row = await installations.register(userId, {
      installationId,
      providerToken,
      permissionGranted: true,
      channel: 'WEB_PUSH',
      os: 'ANDROID',
    });
    fixtureInstallations.push(row.id);
    return row;
  }

  async function createNotification(
    userId: string,
  ): Promise<NotificationRecord> {
    const notification = await prisma.notification.create({
      data: {
        userId,
        type: 'ORDER_STATUS',
        source: 'SYSTEM',
        title: 'NOT-05 integration notification',
        body: 'safe test body',
        payload: { orderId: randomUUID(), status: 'SHIPPED' },
      },
    });
    fixtureNotifications.push(notification.id);
    return notification as NotificationRecord;
  }
});

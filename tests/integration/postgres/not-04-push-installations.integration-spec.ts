import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { AuthModule } from '../../../src/modules/auth/auth.module';
import { SessionLifecycleService } from '../../../src/modules/auth/application/session-lifecycle.service';
import { AuthSubjectType } from '../../../src/modules/auth/domain/subject-type';
import { AuthSessionRepository } from '../../../src/modules/auth/infrastructure/auth-session.repository';
import { NotificationsModule } from '../../../src/modules/notifications/notifications.module';
import { NotificationDeliveryRepository } from '../../../src/modules/notifications/infrastructure/notification-delivery.repository';
import { PushInstallationRepository } from '../../../src/modules/notifications/infrastructure/push-installation.repository';
import { UsersModule } from '../../../src/modules/users/users.module';
import { postgresIntegrationImports } from '../support/postgres-testing-module';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';
import { ConcurrencyGate } from '../support/concurrency-gate';

describe('NOT-04 push installations and delivery (PostgreSQL integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let installations: PushInstallationRepository;
  let deliveries: NotificationDeliveryRepository;
  let sessions: AuthSessionRepository;
  let lifecycle: SessionLifecycleService;
  const userIds: string[] = [];
  const installationIds: string[] = [];
  const notificationIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: postgresIntegrationImports([
        UsersModule,
        NotificationsModule,
        AuthModule,
      ]),
    }).compile();
    app = moduleRef;
    prisma = app.get(PrismaService);
    installations = app.get(PushInstallationRepository);
    deliveries = app.get(NotificationDeliveryRepository);
    sessions = app.get(AuthSessionRepository);
    lifecycle = app.get(SessionLifecycleService);
    await app.init();
  });

  beforeEach(async () => {
    assertDestructiveOperationsAllowed();
    await cleanupScopedFixtures();
  });

  afterEach(async () => {
    await prisma.notificationDelivery.deleteMany({
      where: {
        OR: [
          { installationId: { in: installationIds } },
          { notificationId: { in: notificationIds } },
        ],
      },
    });
    await prisma.notification.deleteMany({
      where: { id: { in: notificationIds } },
    });
    await prisma.pushInstallation.deleteMany({
      where: { installationId: { in: installationIds } },
    });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    installationIds.length = 0;
    notificationIds.length = 0;
  });

  afterAll(async () => app.close());

  async function cleanupScopedFixtures(): Promise<void> {
    const scopedInstallations = await prisma.pushInstallation.findMany({
      where: { providerToken: { startsWith: 'token-' } },
      select: { id: true, userId: true },
    });
    const scopedNotifications = await prisma.notification.findMany({
      where: { title: 'Test notification' },
      select: { id: true },
    });
    await prisma.notificationDelivery.deleteMany({
      where: {
        OR: [
          { installationId: { in: scopedInstallations.map(({ id }) => id) } },
          { notificationId: { in: scopedNotifications.map(({ id }) => id) } },
        ],
      },
    });
    await prisma.notification.deleteMany({
      where: { id: { in: scopedNotifications.map(({ id }) => id) } },
    });
    await prisma.pushInstallation.deleteMany({
      where: { id: { in: scopedInstallations.map(({ id }) => id) } },
    });
    const scopedUsers = await prisma.user.findMany({
      where: { phone: { startsWith: '+989121' } },
      select: { id: true },
    });
    await prisma.authSession.deleteMany({
      where: { userId: { in: scopedUsers.map(({ id }) => id) } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: scopedUsers.map(({ id }) => id) } },
    });
  }

  it('converges concurrent same-user registration to one active installation', async () => {
    const user = await createUser();
    const installationId = randomUUID();
    installationIds.push(installationId);
    const gate = new ConcurrencyGate(8);
    const results = await Promise.all(
      Array.from({ length: 8 }, async () => {
        await gate.arriveAndWait();
        return installations.register(user.id, {
          installationId,
          providerToken: 'token-same',
          permissionGranted: true,
        });
      }),
    );
    expect(new Set(results.map((row) => row.id)).size).toBe(1);
    expect(
      await prisma.pushInstallation.count({ where: { installationId } }),
    ).toBe(1);
    expect(
      await prisma.pushInstallation.count({
        where: { installationId, userId: user.id, status: 'ACTIVE' },
      }),
    ).toBe(1);
  });

  it('rotates a token without changing the logical installation', async () => {
    const user = await createUser();
    const installationId = randomUUID();
    installationIds.push(installationId);
    const first = await installations.register(user.id, {
      installationId,
      providerToken: 'token-before-rotation',
      permissionGranted: true,
    });
    const second = await installations.register(user.id, {
      installationId,
      providerToken: 'token-after-rotation',
      permissionGranted: true,
    });
    expect(second.id).toBe(first.id);
    await expect(
      prisma.pushInstallation.findUnique({
        where: { providerToken: 'token-before-rotation' },
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.pushInstallation.findUnique({
        where: { providerToken: 'token-after-rotation' },
      }),
    ).resolves.toMatchObject({
      id: first.id,
      userId: user.id,
      status: 'ACTIVE',
    });
  });

  it('protects active ownership and permits one concurrent revoked-owner winner', async () => {
    const owner = await createUser();
    const other = await createUser();
    const third = await createUser();
    const installationId = randomUUID();
    installationIds.push(installationId);
    await installations.register(owner.id, {
      installationId,
      providerToken: 'token-owner',
      permissionGranted: true,
    });
    await expect(
      installations.register(other.id, {
        installationId,
        providerToken: 'token-other',
        permissionGranted: true,
      }),
    ).rejects.toMatchObject({ code: 'NOTIFICATION_INSTALLATION_CONFLICT' });

    await installations.revokeOwned(owner.id, installationId);
    const gate = new ConcurrencyGate(2);
    const results = await Promise.allSettled(
      [other, third].map(async (user, index) => {
        await gate.arriveAndWait();
        return installations.register(user.id, {
          installationId,
          providerToken: `token-revoked-${index}`,
          permissionGranted: true,
        });
      }),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      await prisma.pushInstallation.count({
        where: { installationId, status: 'ACTIVE' },
      }),
    ).toBe(1);
    expect([other.id, third.id]).toContain(
      (await prisma.pushInstallation.findUnique({ where: { installationId } }))
        ?.userId,
    );
  });

  it('keeps revoke idempotent and ownership-safe, and excludes invalidated installations', async () => {
    const owner = await createUser();
    const other = await createUser();
    const installationId = randomUUID();
    installationIds.push(installationId);
    await installations.register(owner.id, {
      installationId,
      providerToken: 'token-revoke',
      permissionGranted: true,
    });
    await expect(
      installations.revokeOwned(other.id, installationId),
    ).rejects.toMatchObject({
      code: 'NOTIFICATION_INSTALLATION_NOT_FOUND',
    });
    await installations.revokeOwned(owner.id, installationId);
    await expect(
      installations.revokeOwned(owner.id, installationId),
    ).resolves.toBeUndefined();
    await installations.register(owner.id, {
      installationId,
      providerToken: 'token-invalidated',
      permissionGranted: true,
    });
    await installations.invalidate(
      (
        await prisma.pushInstallation.findUniqueOrThrow({
          where: { installationId },
        })
      ).id,
    );
    await expect(installations.findEligible(owner.id)).resolves.toEqual([]);
  });

  it('excludes disabled users and logout-all revokes only the caller installations', async () => {
    const user = await createUser();
    const other = await createUser();
    const first = await register(user.id, 'token-logout-1');
    await register(user.id, 'token-logout-2');
    const otherInstallation = await register(other.id, 'token-logout-other');
    await sessions.createSession({
      userId: user.id,
      refreshTokenHash: 'a'.repeat(43),
      tokenFamilyId: randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await sessions.createSession({
      userId: other.id,
      refreshTokenHash: 'b'.repeat(43),
      tokenFamilyId: randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });
    expect(await installations.findEligible(user.id)).toEqual([]);

    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: true },
    });
    await lifecycle.logoutAll({
      subjectId: user.id,
      subjectType: AuthSubjectType.USER,
      sessionId: randomUUID(),
    });
    expect(
      await prisma.pushInstallation.count({
        where: { userId: user.id, status: 'ACTIVE' },
      }),
    ).toBe(0);
    expect(
      await prisma.pushInstallation.count({
        where: { id: otherInstallation.id, status: 'ACTIVE' },
      }),
    ).toBe(1);
    expect(
      await sessions.listActiveSessionsForUser(user.id, new Date()),
    ).toEqual([]);
    expect(
      await sessions.listActiveSessionsForUser(other.id, new Date()),
    ).toHaveLength(1);
    expect(first.id).toBeDefined();
  });

  it('reliably creates one delivery per notification/install/channel and preserves FKs', async () => {
    const user = await createUser();
    const first = await register(user.id, 'token-delivery-1');
    const second = await register(user.id, 'token-delivery-2');
    const notification = await prisma.notification.create({
      data: {
        userId: user.id,
        type: 'ORDER_STATUS',
        source: 'SYSTEM',
        title: 'Test notification',
        body: 'Test body',
        payload: { safe: true },
      },
    });
    notificationIds.push(notification.id);
    const gate = new ConcurrencyGate(8);
    const inputs = {
      notificationId: notification.id,
      installationId: first.id,
      channel: 'WEB_PUSH',
    } as const;
    const rows = await Promise.all(
      Array.from({ length: 8 }, async () => {
        await gate.arriveAndWait();
        return deliveries.createIfAbsent(inputs);
      }),
    );
    expect(new Set(rows.map((row) => row.id)).size).toBe(1);
    await deliveries.createIfAbsent({
      ...inputs,
      installationId: second.id,
    });
    expect(
      await prisma.notificationDelivery.count({
        where: { notificationId: notification.id },
      }),
    ).toBe(2);
    await expect(
      prisma.notificationDelivery.create({
        data: {
          notificationId: randomUUID(),
          installationId: first.id,
          channel: 'WEB_PUSH',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.pushInstallation.delete({ where: { id: first.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  async function createUser(isActive = true): Promise<{ id: string }> {
    const user = await prisma.user.create({
      data: {
        phone: `+98912${String(1000000 + userIds.length).padStart(7, '0')}`,
        isActive,
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function register(
    userId: string,
    providerToken: string,
  ): Promise<Awaited<ReturnType<PushInstallationRepository['register']>>> {
    const installationId = randomUUID();
    installationIds.push(installationId);
    return installations.register(userId, {
      installationId,
      providerToken,
      permissionGranted: true,
    });
  }
});

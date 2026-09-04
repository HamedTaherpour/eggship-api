import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApplication } from '../src/app.setup';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import { postgresIntegrationImports } from '../tests/integration/support/postgres-testing-module';
import { UsersModule } from '../src/modules/users/users.module';
import { NotificationsModule } from '../src/modules/notifications/notifications.module';
import { AuthModule } from '../src/modules/auth/auth.module';
import { AccessTokenService } from '../src/modules/auth/infrastructure/access-token.service';
import { AuthSubjectType } from '../src/modules/auth/domain/subject-type';
import { ACCESS_TOKEN_COOKIE_NAME } from '../src/modules/auth/domain/auth-cookies';
import {
  bootstrapBrowserCsrf,
  browserRequest,
  type BrowserCsrfSession,
} from './helpers/csrf-browser';

describe('NOT-04 push installations (focused e2e)', () => {
  type InstallationResponse = {
    data: {
      id: string;
      installationId: string;
      status: string;
      permissionGranted: boolean;
    };
  };
  let app: INestApplication;
  let prisma: PrismaService;
  let accessTokens: AccessTokenService;
  let csrf: BrowserCsrfSession;
  const userIds: string[] = [];
  const installationIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: postgresIntegrationImports([
        UsersModule,
        NotificationsModule,
        AuthModule,
      ]),
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    accessTokens = app.get(AccessTokenService);
  });

  beforeEach(async () => {
    csrf = await bootstrapBrowserCsrf(server());
  });

  afterEach(async () => {
    await prisma.notificationDelivery.deleteMany({
      where: { installationId: { in: installationIds } },
    });
    await prisma.pushInstallation.deleteMany({
      where: { installationId: { in: installationIds } },
    });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    installationIds.length = 0;
  });

  afterAll(async () => app.close());

  it('enforces authentication, customer ownership, strict input, and response privacy', async () => {
    const installationId = randomUUID();
    await browserRequest(
      request(server())
        .put(`/api/v1/notifications/installations/${installationId}`)
        .send(registration(installationId, 'e2e-token-anonymous')),
      csrf,
    ).expect(401);

    const adminToken = await token(AuthSubjectType.ADMIN);
    await request(server())
      .put(`/api/v1/notifications/installations/${installationId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(registration(installationId, 'e2e-token-admin'))
      .expect(403);

    const user = await createUser();
    const userToken = await token(AuthSubjectType.USER, user.id);
    const response = await request(server())
      .put(`/api/v1/notifications/installations/${installationId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send(registration(installationId, 'e2e-token-private'))
      .expect(200);
    installationIds.push(installationId);
    expect(response.headers['cache-control']).toBe('no-store');
    const responseBody = response.body as InstallationResponse;
    expect(responseBody.data).toMatchObject({
      installationId,
      status: 'ACTIVE',
      permissionGranted: true,
    });
    expect(JSON.stringify(response.body)).not.toContain('e2e-token-private');

    await request(server())
      .put(`/api/v1/notifications/installations/${installationId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        ...registration(installationId, 'e2e-token-private'),
        extra: true,
      })
      .expect(400);
    await request(server())
      .put(`/api/v1/notifications/installations/${installationId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        ...registration(installationId, ''),
        provider: 'FCM',
        platform: 'web',
      })
      .expect(400);
    await request(server())
      .put('/api/v1/notifications/installations/not-a-uuid')
      .set('Authorization', `Bearer ${userToken}`)
      .send(registration(installationId, 'e2e-token-invalid-id'))
      .expect(400);
  });

  it('supports idempotent registration, token rotation, and Bearer mutations', async () => {
    const user = await createUser();
    const accessToken = await token(AuthSubjectType.USER, user.id);
    const installationId = randomUUID();
    installationIds.push(installationId);
    const first = await request(server())
      .put(`/api/v1/notifications/installations/${installationId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(registration(installationId, 'e2e-token-first'))
      .expect(200);
    const second = await request(server())
      .put(`/api/v1/notifications/installations/${installationId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(registration(installationId, 'e2e-token-second'))
      .expect(200);
    const firstBody = first.body as InstallationResponse;
    const secondBody = second.body as InstallationResponse;
    expect(secondBody.data.id).toBe(firstBody.data.id);
    expect(
      (await prisma.pushInstallation.findUnique({ where: { installationId } }))
        ?.providerToken,
    ).toBe('e2e-token-second');

    const csrfless = await request(server())
      .delete(`/api/v1/notifications/installations/${installationId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
    expect(csrfless.headers['cache-control']).toBe('no-store');
    await request(server())
      .delete(`/api/v1/notifications/installations/${installationId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
  });

  it('requires CSRF for cookie mutations and protects cross-user lifecycle operations', async () => {
    const owner = await createUser();
    const other = await createUser();
    const ownerToken = await token(AuthSubjectType.USER, owner.id);
    const otherToken = await token(AuthSubjectType.USER, other.id);
    const installationId = randomUUID();
    installationIds.push(installationId);
    const cookie = `${ACCESS_TOKEN_COOKIE_NAME}=${ownerToken}`;
    await request(server())
      .put(`/api/v1/notifications/installations/${installationId}`)
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', cookie)
      .send(registration(installationId, 'e2e-token-cookie'))
      .expect(403);
    await browserRequest(
      request(server())
        .put(`/api/v1/notifications/installations/${installationId}`)
        .send(registration(installationId, 'e2e-token-cookie')),
      csrf,
      [cookie],
    ).expect(200);

    await request(server())
      .put(`/api/v1/notifications/installations/${installationId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send(registration(installationId, 'e2e-token-takeover'))
      .expect(409);
    await request(server())
      .delete(`/api/v1/notifications/installations/${installationId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    await request(server())
      .delete(`/api/v1/notifications/installations/${randomUUID()}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(204);
    await browserRequest(
      request(server()).delete(
        `/api/v1/notifications/installations/${installationId}`,
      ),
      csrf,
      [cookie],
    ).expect(204);
  });

  it('reactivates a revoked installation for another user and logout-all revokes only the owner', async () => {
    const owner = await createUser();
    const other = await createUser();
    const ownerToken = await token(AuthSubjectType.USER, owner.id);
    const otherToken = await token(AuthSubjectType.USER, other.id);
    const installationId = randomUUID();
    installationIds.push(installationId);
    await request(server())
      .put(`/api/v1/notifications/installations/${installationId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(registration(installationId, 'e2e-token-reactivate'))
      .expect(200);
    await request(server())
      .delete(`/api/v1/notifications/installations/${installationId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);
    await request(server())
      .put(`/api/v1/notifications/installations/${installationId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send(registration(installationId, 'e2e-token-reactivated'))
      .expect(200);
    const otherInstallationId = randomUUID();
    installationIds.push(otherInstallationId);
    await request(server())
      .put(`/api/v1/notifications/installations/${otherInstallationId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send(registration(otherInstallationId, 'e2e-token-other'))
      .expect(200);
    await request(server())
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(
      await prisma.pushInstallation.count({
        where: { userId: other.id, status: 'ACTIVE' },
      }),
    ).toBe(0);
    expect(
      await prisma.pushInstallation.count({
        where: { userId: owner.id, status: 'ACTIVE' },
      }),
    ).toBe(0);
  });

  function server(): Server {
    return app.getHttpServer() as Server;
  }

  async function createUser(): Promise<{ id: string }> {
    const user = await prisma.user.create({
      data: {
        phone: `+98912${String(2000000 + userIds.length).padStart(7, '0')}`,
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function token(
    subjectType: AuthSubjectType,
    subjectId: string = randomUUID(),
  ): Promise<string> {
    return (
      await accessTokens.issueAccessToken({
        subjectId,
        subjectType,
        sessionId: randomUUID(),
      })
    ).token;
  }

  function registration(
    installationId: string,
    providerToken: string,
  ): { installationId: string; providerToken: string; permissionGranted: boolean } {
    return { installationId, providerToken, permissionGranted: true };
  }
});

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { configureApplication } from '../src/app.setup';
import { createConfigModuleOptions } from '../src/config/config-module.options';
import { ObservabilityModule } from '../src/common/observability/observability.module';
import { AuthorizationModule } from '../src/common/authz/authorization.module';
import { ADMIN_ROLE_RESOLVER } from '../src/common/authz/authorization.tokens';
import { PrismaModule } from '../src/infrastructure/database/prisma/prisma.module';
import { RedisModule } from '../src/infrastructure/redis/redis.module';
import { AdminsModule } from '../src/modules/admins/admins.module';
import { AuthModule } from '../src/modules/auth/auth.module';
import { UsersModule } from '../src/modules/users/users.module';
import { VisitorsModule } from '../src/modules/visitors/visitors.module';
import { AuditModule } from '../src/modules/audit/audit.module';
import { AsyncRecoveryModule } from '../src/modules/async-recovery/async-recovery.module';
import { PrismaAdminRoleResolver } from '../src/modules/admins/infrastructure/prisma-admin-role.resolver';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import { AccessTokenService } from '../src/modules/auth/infrastructure/access-token.service';
import { AuthSubjectType } from '../src/modules/auth/domain/subject-type';
import { AdminRole } from '../src/common/authz/admin-role';
import { RECOVERY_PROCESSORS } from '../src/modules/async-recovery/domain/async-recovery';
import { AsyncFailureCategory } from '../src/modules/async-recovery/domain/async-recovery';

describe('ASY-04 Admin API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let deniedTokens: string[];
  let failureId: string;
  let outboxId: string;
  let adminIds: string[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        PrismaModule,
        RedisModule,
        UsersModule,
        VisitorsModule,
        AuditModule,
        AuthModule,
        AdminsModule,
        AuthorizationModule.forRoot({
          imports: [AdminsModule],
          adminRoleResolver: {
            provide: ADMIN_ROLE_RESOLVER,
            useExisting: PrismaAdminRoleResolver,
          },
        }),
        AsyncRecoveryModule,
      ],
    })
      .overrideProvider(RECOVERY_PROCESSORS)
      .useValue([
        {
          identity: 'test.recovery.v1',
          queueName: 'test-recovery',
          jobName: 'test.recovery',
          eventType: 'test.recovery.requested',
          eventVersion: 1,
          replaySafe: true,
          idempotencyDescription: 'test',
          executeReplay: jest.fn(),
        },
      ])
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    const adminId = randomUUID();
    const deniedAdminIds = [randomUUID(), randomUUID()];
    adminIds = [adminId, ...deniedAdminIds];
    await prisma.admin.create({
      data: {
        id: adminId,
        email: `asy04-${adminId}@example.test`,
        passwordHash: 'x'.repeat(32),
        role: AdminRole.SUPER_ADMIN,
      },
    });
    await prisma.admin.createMany({
      data: [
        {
          id: deniedAdminIds[0],
          email: `asy04-order-ops-${deniedAdminIds[0]}@example.test`,
          passwordHash: 'x'.repeat(32),
          role: AdminRole.ORDER_OPS,
        },
        {
          id: deniedAdminIds[1],
          email: `asy04-warehouse-${deniedAdminIds[1]}@example.test`,
          passwordHash: 'x'.repeat(32),
          role: AdminRole.WAREHOUSE,
        },
      ],
    });
    token = (
      await app.get(AccessTokenService).issueAccessToken({
        subjectId: adminId,
        subjectType: AuthSubjectType.ADMIN,
        sessionId: randomUUID(),
      })
    ).token;
    deniedTokens = await Promise.all(
      deniedAdminIds.map(
        async (subjectId) =>
          (
            await app.get(AccessTokenService).issueAccessToken({
              subjectId,
              subjectType: AuthSubjectType.ADMIN,
              sessionId: randomUUID(),
            })
          ).token,
      ),
    );
    const userToken = (
      await app.get(AccessTokenService).issueAccessToken({
        subjectId: randomUUID(),
        subjectType: AuthSubjectType.USER,
        sessionId: randomUUID(),
      })
    ).token;
    deniedTokens.push(userToken);
    outboxId = randomUUID();
    await prisma.outboxEvent.create({
      data: {
        id: outboxId,
        eventType: 'test.recovery.requested',
        eventVersion: 1,
        correlationId: `asy04_e2e_${adminId}`,
        occurredAt: new Date(),
        payload: { safeReference: 'e2e' },
      },
    });
    const failure = await prisma.asyncFailure.create({
      data: {
        outboxEventId: outboxId,
        processorIdentity: 'test.recovery.v1',
        queueName: 'test-recovery',
        jobName: 'test.recovery',
        eventType: 'test.recovery.requested',
        eventVersion: 1,
        correlationId: `asy04_e2e_${adminId}`,
        category: AsyncFailureCategory.UNKNOWN,
        reasonCode: 'job_failed',
        attemptCount: 1,
      },
    });
    failureId = failure.id;
  });

  afterAll(async () => {
    if (prisma !== undefined && failureId !== undefined) {
      await prisma.asyncReplay.deleteMany({ where: { failureId } });
      await prisma.asyncFailure.deleteMany({ where: { id: failureId } });
      await prisma.outboxEvent.deleteMany({ where: { id: outboxId } });
      if (adminIds !== undefined) {
        await prisma.admin.deleteMany({ where: { id: { in: adminIds } } });
      }
    }
    if (app !== undefined) await app.close();
  });

  it('enforces the authorization matrix and safe Admin API contract', async () => {
    const endpoint = `/api/v1/admin/async-failures/${failureId}`;
    const server = app.getHttpServer() as Server;
    await request(server).get('/api/v1/admin/async-failures').expect(401);
    for (const deniedToken of deniedTokens) {
      await request(server)
        .get('/api/v1/admin/async-failures')
        .set('Authorization', `Bearer ${deniedToken}`)
        .expect(403);
    }
    const list = await request(server)
      .get('/api/v1/admin/async-failures?page=1&pageSize=10')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.headers['cache-control']).toBe('no-store');
    expect((list.body as { meta: unknown }).meta).toMatchObject({
      page: 1,
      pageSize: 10,
    });
    expect(JSON.stringify(list.body)).not.toMatch(
      /payload|stack|provider response|token|secret|email|phone/iu,
    );
    const detail = await request(server)
      .get(endpoint)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((detail.body as { data: unknown }).data).toMatchObject({
      id: failureId,
      processorIdentity: 'test.recovery.v1',
    });
    expect(JSON.stringify(detail.body)).not.toMatch(
      /payload|stack|provider response|token|secret|email|phone/iu,
    );
    await request(server)
      .post(`${endpoint}/replays`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await request(server)
      .post(`${endpoint}/quarantine`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await request(server)
      .post(`${endpoint}/replays`)
      .set('Authorization', `Bearer ${token}`)
      .expect(500);
    await request(server)
      .post(`${endpoint}/unquarantine`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await request(server)
      .post(`${endpoint}/acknowledge`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await request(server)
      .post(`${endpoint}/dismiss`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await request(server)
      .get('/api/v1/admin/async-failures/not-an-id')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });
});

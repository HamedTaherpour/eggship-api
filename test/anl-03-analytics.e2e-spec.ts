import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { ConfigModule } from '@nestjs/config';
import { createConfigModuleOptions } from '../src/config/config-module.options';
import { configureApplication } from '../src/app.setup';
import { createOpenApiDocument } from '../src/common/openapi/openapi.document';
import { ObservabilityModule } from '../src/common/observability/observability.module';
import { AuthorizationModule } from '../src/common/authz/authorization.module';
import { ADMIN_ROLE_RESOLVER } from '../src/common/authz/authorization.tokens';
import { AdminRole } from '../src/common/authz/admin-role';
import type {
  AdminRoleResolver,
  AdminAuthorizationLookup,
} from '../src/common/authz/admin-role-resolver';
import { AuthSubjectType } from '../src/modules/auth/domain/subject-type';
import { AnalyticsModule } from '../src/modules/analytics/analytics.module';
import { PrismaModule } from '../src/infrastructure/database/prisma/prisma.module';

jest.setTimeout(30_000);

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
class Roles implements AdminRoleResolver {
  role: AdminRole | undefined;
  findAdminAuthorization(adminId: string): Promise<AdminAuthorizationLookup> {
    return Promise.resolve(
      this.role
        ? {
            status: 'found',
            record: { adminId, role: this.role, isActive: true },
          }
        : { status: 'not_found' },
    );
  }
}

describe('ANL-03 analytics HTTP contract (real PostgreSQL e2e)', () => {
  let app: INestApplication;
  let roles: Roles;
  const token = (subjectType: AuthSubjectType, subjectId = ADMIN_ID): string =>
    jwt.sign(
      {
        sub: subjectId,
        subjectType,
        sessionId: randomUUID(),
        tokenUse: 'access',
      },
      process.env.JWT_ACCESS_SECRET ?? '',
      { algorithm: 'HS256', expiresIn: 900 },
    );

  beforeAll(async () => {
    roles = new Roles();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        AuthorizationModule.forRoot({
          adminRoleResolver: { provide: ADMIN_ROLE_RESOLVER, useValue: roles },
        }),
        PrismaModule,
        AnalyticsModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });
  afterAll(async () => app.close());

  function server(): Server {
    return app.getHttpServer() as Server;
  }

  it('enforces auth/RBAC and validates the sales/top-products HTTP contract', async () => {
    const unauth = await request(server())
      .get('/api/v1/admin/analytics/sales-overview')
      .query({ from: '2026-09-01', to: '2026-09-01' })
      .expect(401);
    expect(unauth.body).not.toHaveProperty('customerPhone');
    await request(server())
      .get('/api/v1/admin/analytics/sales-overview')
      .set(
        'Authorization',
        `Bearer ${token(AuthSubjectType.USER, randomUUID())}`,
      )
      .query({ from: '2026-09-01', to: '2026-09-01' })
      .expect(403);
    roles.role = AdminRole.WAREHOUSE;
    await request(server())
      .get('/api/v1/admin/analytics/sales-overview')
      .set('Authorization', `Bearer ${token(AuthSubjectType.ADMIN)}`)
      .query({ from: '2026-09-01', to: '2026-09-01' })
      .expect(403);
    roles.role = AdminRole.SUPER_ADMIN;
    const response = await request(server())
      .get('/api/v1/admin/analytics/sales-overview')
      .set('Authorization', `Bearer ${token(AuthSubjectType.ADMIN)}`)
      .query({ from: '2027-01-01', to: '2027-01-01' })
      .expect(200);
    const responseBody = response.body as { data: Record<string, unknown> };
    expect(responseBody.data.ordersCreated).toBe(0);
    expect(responseBody.data.grossSales).toBe(0);
    expect(responseBody.data.netSales).toBe(0);
    expect(response.headers['cache-control']).toBe('no-store');
    await request(server())
      .get('/api/v1/admin/analytics/sales-overview')
      .set('Authorization', `Bearer ${token(AuthSubjectType.ADMIN)}`)
      .query({ from: 'bad', to: '2026-09-01' })
      .expect(400);
    await request(server())
      .get('/api/v1/admin/analytics/sales-overview')
      .set('Authorization', `Bearer ${token(AuthSubjectType.ADMIN)}`)
      .query({ from: '2026-09-02', to: '2026-09-01' })
      .expect(400);
    await request(server())
      .get('/api/v1/admin/analytics/top-products')
      .set('Authorization', `Bearer ${token(AuthSubjectType.ADMIN)}`)
      .query({ from: '2026-09-01', to: '2026-09-01', limit: 0 })
      .expect(400);
    await request(server())
      .get('/api/v1/admin/analytics/top-products')
      .set('Authorization', `Bearer ${token(AuthSubjectType.ADMIN)}`)
      .query({ from: '2026-09-01', to: '2026-09-01', unknown: 'x' })
      .expect(400);
  });

  it('serves today pulse with the stable envelope and no PII/order identity', async () => {
    const response = await request(server())
      .get('/api/v1/admin/analytics/today-pulse')
      .set('Authorization', `Bearer ${token(AuthSubjectType.ADMIN)}`)
      .expect(200);
    const responseBody = response.body as { data: Record<string, unknown> };
    expect(responseBody).toHaveProperty('data.ordersCreated');
    expect(responseBody.data).not.toHaveProperty('orderId');
    expect(responseBody.data).not.toHaveProperty('customerPhone');
    expect(response.headers['cache-control']).toBe('no-store');
    const openapi = createOpenApiDocument(app);
    expect(
      openapi.paths['/api/v1/admin/analytics/sales-overview']?.get?.operationId,
    ).toBe('AdminAnalytics_getSalesOverview');
    expect(
      openapi.paths['/api/v1/admin/analytics/top-products']?.get?.operationId,
    ).toBe('AdminAnalytics_getTopProducts');
    expect(
      openapi.paths['/api/v1/admin/analytics/today-pulse']?.get?.operationId,
    ).toBe('AdminAnalytics_getTodayPulse');
  });
});

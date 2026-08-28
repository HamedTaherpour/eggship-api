import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { AdminRole } from '../src/common/authz/admin-role';
import type {
  AdminAuthorizationLookup,
  AdminRoleResolver,
} from '../src/common/authz/admin-role-resolver';
import { ADMIN_ROLE_RESOLVER } from '../src/common/authz/authorization.tokens';
import { createOpenApiDocument } from '../src/common/openapi/openapi.document';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import { AuthSubjectType } from '../src/modules/auth/domain/subject-type';
import { SettlementService } from '../src/modules/settlements/application/settlement.service';
import {
  SettlementStatus,
  type SettlementRecord,
} from '../src/modules/settlements/domain/settlement';
import { OrderStatus } from '../src/modules/orders/domain/order-status';

class RoleResolver implements AdminRoleResolver {
  role: string = AdminRole.SUPER_ADMIN;
  findAdminAuthorization(adminId: string): Promise<AdminAuthorizationLookup> {
    return Promise.resolve({
      status: 'found',
      record: { adminId, role: this.role, isActive: true },
    });
  }
}

function token(subjectType: string, subjectId = randomUUID()): string {
  return jwt.sign(
    {
      sub: subjectId,
      subjectType,
      sessionId: randomUUID(),
      tokenUse: 'access',
    },
    process.env['JWT_ACCESS_SECRET'] ?? '',
    { algorithm: 'HS256', expiresIn: 900 },
  );
}

describe('Admin settlements API (e2e)', () => {
  let app: INestApplication;
  let roles: RoleResolver;
  const adminId = randomUUID();
  const settlementId = randomUUID();
  const orderId = randomUUID();
  const mediaId = randomUUID();
  const value: SettlementRecord = {
    id: settlementId,
    orderId,
    orderStatus: OrderStatus.DELIVERED,
    orderTotal: 25_000n,
    status: SettlementStatus.OPEN,
    dueAt: new Date('2026-08-20T00:00:00.000Z'),
    overdue: true,
    settledAt: null,
    settledByAdminId: null,
    receiptMediaId: null,
    receiptAttachedAt: null,
    receiptAttachedByAdminId: null,
    createdByAdminId: adminId,
    createdAt: new Date('2026-08-19T00:00:00.000Z'),
    updatedAt: new Date('2026-08-19T00:00:00.000Z'),
  };
  const service = {
    listAdmin: jest.fn(),
    getAdminById: jest.fn(),
    create: jest.fn(),
    changeDueAt: jest.fn(),
    attachReceipt: jest.fn(),
    markSettled: jest.fn(),
  };

  beforeAll(async () => {
    roles = new RoleResolver();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: (): void => undefined,
        onModuleDestroy: (): void => undefined,
      })
      .overrideProvider(ADMIN_ROLE_RESOLVER)
      .useValue(roles)
      .overrideProvider(SettlementService)
      .useValue(service)
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    roles.role = AdminRole.SUPER_ADMIN;
    service.listAdmin.mockResolvedValue({
      data: [value],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    service.getAdminById.mockResolvedValue(value);
    service.create.mockResolvedValue(value);
    service.changeDueAt.mockResolvedValue(value);
    service.attachReceipt.mockResolvedValue({
      ...value,
      receiptMediaId: mediaId,
    });
    service.markSettled.mockResolvedValue({
      ...value,
      status: SettlementStatus.SETTLED,
      receiptMediaId: mediaId,
      settledAt: new Date(),
      settledByAdminId: adminId,
    });
  });

  afterAll(async () => app.close());
  const server = (): Server => app.getHttpServer() as Server;
  const adminToken = (): string => token(AuthSubjectType.ADMIN, adminId);

  it('documents list, detail, create, due-date, receipt, and settle operations', () => {
    const paths = createOpenApiDocument(app).paths;
    expect(paths['/api/v1/admin/settlements']?.get).toBeDefined();
    expect(paths['/api/v1/admin/settlements']?.post).toBeDefined();
    expect(paths['/api/v1/admin/settlements/{id}']?.get).toBeDefined();
    expect(
      paths['/api/v1/admin/settlements/{id}/change-due-date']?.post,
    ).toBeDefined();
    expect(paths['/api/v1/admin/settlements/{id}/receipt']?.post).toBeDefined();
    expect(paths['/api/v1/admin/settlements/{id}/settle']?.post).toBeDefined();
  });

  it('returns 401 unauthenticated and 403 to USER, WAREHOUSE, and ORDER_OPS', async () => {
    await request(server()).get('/api/v1/admin/settlements').expect(401);
    await request(server())
      .get('/api/v1/admin/settlements')
      .set('Authorization', `Bearer ${token(AuthSubjectType.USER)}`)
      .expect(403);
    for (const role of [AdminRole.WAREHOUSE, AdminRole.ORDER_OPS]) {
      roles.role = role;
      await request(server())
        .get('/api/v1/admin/settlements')
        .set('Authorization', `Bearer ${adminToken()}`)
        .expect(403);
      await request(server())
        .post('/api/v1/admin/settlements')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ orderId, dueAt: value.dueAt.toISOString() })
        .expect(403);
    }
  });

  it('allows SUPER_ADMIN list filters/sort and returns the standard envelope', async () => {
    const response = await request(server())
      .get(
        `/api/v1/admin/settlements?status=OPEN&overdue=true&dueFrom=2026-08-01T00%3A00%3A00Z&dueTo=2026-08-31T00%3A00%3A00Z&orderId=${orderId}&sortBy=dueAt&sortOrder=asc`,
      )
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(200);
    expect(response.body).toMatchObject({
      data: [{ id: settlementId, orderTotal: 25000, overdue: true }],
      meta: { page: 1, pageSize: 20, total: 1 },
    });
    expect(service.listAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'OPEN',
        overdue: true,
        orderId,
        sortBy: 'dueAt',
        sortOrder: 'asc',
      }),
    );
  });

  it('runs create, detail, due-date, receipt, and settle commands with the principal actor', async () => {
    const auth = adminToken();
    await request(server())
      .post('/api/v1/admin/settlements')
      .set('Authorization', `Bearer ${auth}`)
      .send({ orderId, dueAt: value.dueAt.toISOString() })
      .expect(201);
    expect(service.create).toHaveBeenCalledWith(
      orderId,
      value.dueAt.toISOString(),
      adminId,
    );
    await request(server())
      .get(`/api/v1/admin/settlements/${settlementId}`)
      .set('Authorization', `Bearer ${auth}`)
      .expect(200);
    await request(server())
      .post(`/api/v1/admin/settlements/${settlementId}/change-due-date`)
      .set('Authorization', `Bearer ${auth}`)
      .send({ dueAt: '2026-09-01T00:00:00.000Z' })
      .expect(200);
    await request(server())
      .post(`/api/v1/admin/settlements/${settlementId}/receipt`)
      .set('Authorization', `Bearer ${auth}`)
      .send({ mediaId })
      .expect(200);
    await request(server())
      .post(`/api/v1/admin/settlements/${settlementId}/settle`)
      .set('Authorization', `Bearer ${auth}`)
      .expect(200);
    expect(service.attachReceipt).toHaveBeenCalledWith(
      settlementId,
      mediaId,
      adminId,
    );
    expect(service.markSettled).toHaveBeenCalledWith(settlementId, adminId);
  });

  it('rejects unknown query/body properties and invalid UUIDs', async () => {
    const auth = adminToken();
    await request(server())
      .get('/api/v1/admin/settlements?search=x')
      .set('Authorization', `Bearer ${auth}`)
      .expect(400);
    await request(server())
      .post('/api/v1/admin/settlements')
      .set('Authorization', `Bearer ${auth}`)
      .send({ orderId, dueAt: value.dueAt.toISOString(), amount: 1 })
      .expect(400);
    await request(server())
      .post(`/api/v1/admin/settlements/${settlementId}/receipt`)
      .set('Authorization', `Bearer ${auth}`)
      .send({ mediaId: 'not-a-uuid' })
      .expect(400);
  });
});

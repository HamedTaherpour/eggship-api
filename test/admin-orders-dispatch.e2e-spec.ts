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
import { OrderReadService } from '../src/modules/orders/application/order-read.service';
import { OrderStatus } from '../src/modules/orders/domain/order-status';
import { ADMIN_DISPATCH_ORDER_LIMIT } from '../src/modules/orders/domain/order-dispatch';

const REGION_ID = '33333333-3333-4333-8333-333333333333';
const ORDER_ID = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-09-02T10:00:00.000Z');

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

describe('Admin Orders Dispatch HTTP (ORD-07 Slice 5, e2e)', () => {
  let app: INestApplication;
  let roles: RoleResolver;
  const adminId = randomUUID();
  const getDispatchBoard = jest.fn();

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
      .overrideProvider(OrderReadService)
      .useValue({
        listAdmin: jest.fn(),
        getAdmin: jest.fn(),
        listOwned: jest.fn(),
        getOwned: jest.fn(),
        getDispatchBoard,
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    roles.role = AdminRole.SUPER_ADMIN;
    getDispatchBoard.mockResolvedValue({
      summary: {
        ordersCount: 1,
        confirmedCount: 1,
        shippedCount: 0,
        regionCount: 1,
        limit: ADMIN_DISPATCH_ORDER_LIMIT,
        truncated: false,
        matchedCount: 1,
      },
      groups: [
        {
          region: { id: REGION_ID, name: 'Tehran' },
          ordersCount: 1,
          orders: [
            {
              id: ORDER_ID,
              status: OrderStatus.CONFIRMED,
              customerPhone: '+989121234567',
              regionId: REGION_ID,
              regionName: 'Tehran',
              total: 20_000n,
              lineCount: 2,
              deliveryAt: null,
              confirmedAt: NOW,
              shippedAt: null,
              createdAt: NOW,
            },
          ],
        },
      ],
    });
  });

  afterAll(async () => app.close());

  const server = (): Server => app.getHttpServer() as Server;
  const adminToken = (): string => token(AuthSubjectType.ADMIN, adminId);

  it('documents the dedicated dispatch operation', () => {
    const paths = createOpenApiDocument(app).paths;
    expect(paths['/api/v1/admin/orders/dispatch']?.get).toBeDefined();
    expect(paths['/api/v1/admin/orders']?.get).toBeDefined();
  });

  it('returns 401 unauthenticated and 403 for USER or Admin without ORDER_READ', async () => {
    await request(server()).get('/api/v1/admin/orders/dispatch').expect(401);

    await request(server())
      .get('/api/v1/admin/orders/dispatch')
      .set('Authorization', `Bearer ${token(AuthSubjectType.USER)}`)
      .expect(403);

    roles.role = 'UNKNOWN_NO_ORDER_READ';
    await request(server())
      .get('/api/v1/admin/orders/dispatch')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(403);
    expect(getDispatchBoard).not.toHaveBeenCalled();
  });

  it('allows WAREHOUSE (ORDER_READ without ORDER_TRANSITION) and returns the board shape', async () => {
    roles.role = AdminRole.WAREHOUSE;
    const response = await request(server())
      .get('/api/v1/admin/orders/dispatch')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      data: {
        summary: {
          ordersCount: 1,
          confirmedCount: 1,
          shippedCount: 0,
          regionCount: 1,
          truncated: false,
          matchedCount: 1,
          limit: ADMIN_DISPATCH_ORDER_LIMIT,
        },
        groups: [
          {
            region: { id: REGION_ID, name: 'Tehran' },
            ordersCount: 1,
            orders: [
              {
                id: ORDER_ID,
                status: OrderStatus.CONFIRMED,
                customerPhone: '+989121234567',
                lineCount: 2,
                total: 20000,
              },
            ],
          },
        ],
      },
    });
    expect(getDispatchBoard).toHaveBeenCalledWith({});
  });

  it('accepts pipeline filters and rejects invalid status or unknown query keys', async () => {
    roles.role = AdminRole.ORDER_OPS;
    await request(server())
      .get(`/api/v1/admin/orders/dispatch?regionId=${REGION_ID}&status=SHIPPED`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(200);
    expect(getDispatchBoard).toHaveBeenCalledWith({
      regionId: REGION_ID,
      status: OrderStatus.SHIPPED,
    });

    await request(server())
      .get('/api/v1/admin/orders/dispatch?status=DELIVERED')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(400);

    await request(server())
      .get('/api/v1/admin/orders/dispatch?search=phone')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(400);
  });
});

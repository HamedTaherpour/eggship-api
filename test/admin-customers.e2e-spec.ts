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
import { AdminCustomerService } from '../src/modules/users/application/admin-customer.service';
import { CustomerNotFoundError } from '../src/modules/users/domain/customer-errors';

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-08-21T12:00:00.000Z');

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

describe('Admin Customers HTTP (ADM-02, e2e)', () => {
  let app: INestApplication;
  let roles: RoleResolver;
  const adminId = randomUUID();
  const listAdmin = jest.fn();
  const getAdminById = jest.fn();

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
      .overrideProvider(AdminCustomerService)
      .useValue({ listAdmin, getAdminById })
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    roles.role = AdminRole.SUPER_ADMIN;
    listAdmin.mockResolvedValue({
      data: [
        {
          id: CUSTOMER_ID,
          phone: '+989121234567',
          isActive: true,
          createdAt: NOW,
          updatedAt: NOW,
          referral: {
            visitorId: randomUUID(),
            visitorName: 'Bazaar promoter',
            visitorIsActive: true,
            referralCode: 'ABCD2345EF',
            attributedAt: NOW,
          },
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    getAdminById.mockImplementation((id: string): Promise<unknown> => {
      if (id !== CUSTOMER_ID) {
        return Promise.reject(new CustomerNotFoundError());
      }
      return Promise.resolve({
        id: CUSTOMER_ID,
        phone: '+989121234567',
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
        referral: null,
      });
    });
  });

  afterAll(async () => app.close());

  const server = (): Server => app.getHttpServer() as Server;
  const adminToken = (): string => token(AuthSubjectType.ADMIN, adminId);
  const userToken = (): string => token(AuthSubjectType.USER);

  it('lists customers for SUPER_ADMIN with paginated envelope and no-store', async () => {
    const response = await request(server())
      .get('/api/v1/admin/customers')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      data: [
        {
          id: CUSTOMER_ID,
          phone: '+989121234567',
          hasReferral: true,
          referralCode: 'ABCD2345EF',
        },
      ],
      meta: { total: 1 },
    });
    expect(JSON.stringify(response.body)).not.toContain('"referral"');
  });

  it('allows ORDER_OPS (CUSTOMER_READ) but denies WAREHOUSE without the permission', async () => {
    roles.role = AdminRole.ORDER_OPS;
    await request(server())
      .get('/api/v1/admin/customers')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(200);

    roles.role = AdminRole.WAREHOUSE;
    const denied = await request(server())
      .get('/api/v1/admin/customers')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(403);
    expect(denied.body).toMatchObject({
      error: { code: 'AUTH_FORBIDDEN' },
    });
  });

  it('denies customer subjects and anonymous callers without existence leakage', async () => {
    const userDenied = await request(server())
      .get('/api/v1/admin/customers')
      .set('Authorization', `Bearer ${userToken()}`)
      .expect(403);
    expect(userDenied.body).toMatchObject({
      error: { code: 'AUTH_FORBIDDEN' },
    });

    await request(server()).get('/api/v1/admin/customers').expect(401);
  });

  it('returns minimized detail and stable CUSTOMER_NOT_FOUND', async () => {
    const detail = await request(server())
      .get(`/api/v1/admin/customers/${CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(200);
    expect(detail.headers['cache-control']).toBe('no-store');
    expect(detail.body).toMatchObject({
      data: {
        id: CUSTOMER_ID,
        hasReferral: false,
        referralCode: null,
        referral: null,
      },
    });

    const missing = await request(server())
      .get('/api/v1/admin/customers/22222222-2222-4222-8222-222222222222')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(404);
    expect(missing.body).toMatchObject({
      error: { code: 'CUSTOMER_NOT_FOUND' },
    });
  });

  it('rejects unknown list queries instead of ignoring them', async () => {
    await request(server())
      .get('/api/v1/admin/customers?unknownParam=1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(400);
  });

  it('documents stable AdminCustomers operationIds in OpenAPI', () => {
    const document = createOpenApiDocument(app);
    const paths = document.paths as Record<
      string,
      Record<string, { operationId?: string }>
    >;
    expect(paths['/api/v1/admin/customers']?.get?.operationId).toBe(
      'AdminCustomers_list',
    );
    expect(paths['/api/v1/admin/customers/{id}']?.get?.operationId).toBe(
      'AdminCustomers_get',
    );
  });
});

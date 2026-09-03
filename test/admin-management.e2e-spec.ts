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
import { AdminManagementService } from '../src/modules/admins/application/admin-management.service';

const ADMIN_ID = randomUUID();
const TARGET_ID = randomUUID();
const NOW = new Date('2026-09-03T12:00:00.000Z');

class RoleResolver implements AdminRoleResolver {
  role: AdminRole = AdminRole.SUPER_ADMIN;

  findAdminAuthorization(adminId: string): Promise<AdminAuthorizationLookup> {
    return Promise.resolve({
      status: 'found',
      record: { adminId, role: this.role, isActive: true },
    });
  }
}

function token(subjectType: string, subjectId = ADMIN_ID): string {
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

describe('Admin Management HTTP (ADM-01, e2e)', () => {
  let app: INestApplication;
  let roles: RoleResolver;
  const list = jest.fn();
  const get = jest.fn();
  const create = jest.fn();
  const changeRole = jest.fn();
  const setActive = jest.fn();

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
      .overrideProvider(AdminManagementService)
      .useValue({ list, get, create, changeRole, setActive })
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    roles.role = AdminRole.SUPER_ADMIN;
    list.mockResolvedValue({
      items: [
        {
          id: TARGET_ID,
          email: 'target@example.com',
          role: AdminRole.WAREHOUSE,
          isActive: true,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      total: 1,
    });
    get.mockResolvedValue({
      id: TARGET_ID,
      email: 'target@example.com',
      role: AdminRole.WAREHOUSE,
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    create.mockResolvedValue({
      id: TARGET_ID,
      email: 'new@example.com',
      role: AdminRole.ORDER_OPS,
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    changeRole.mockResolvedValue({
      id: TARGET_ID,
      email: 'target@example.com',
      role: AdminRole.ORDER_OPS,
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    setActive.mockResolvedValue({
      id: TARGET_ID,
      email: 'target@example.com',
      role: AdminRole.WAREHOUSE,
      isActive: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  afterAll(async () => app.close());

  const server = (): Server => app.getHttpServer() as Server;
  const adminToken = (): string => token(AuthSubjectType.ADMIN);

  it('lists minimized Admin records with no-store and stable OpenAPI operation ids', async () => {
    const response = await request(server())
      .get('/api/v1/admin/admins')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    const listBody = response.body as { data: unknown[] };
    expect(listBody.data[0]).toEqual({
      id: TARGET_ID,
      email: 'target@example.com',
      role: AdminRole.WAREHOUSE,
      isActive: true,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect(JSON.stringify(response.body)).not.toContain('password');
    const document = createOpenApiDocument(app);
    const paths = document.paths as Record<
      string,
      Record<string, { operationId?: string }>
    >;
    expect(paths['/api/v1/admin/admins']?.get?.operationId).toBe(
      'AdminManagement_list',
    );
  });

  it('requires ADMIN_MANAGE for mutations and rejects non-admin subjects', async () => {
    roles.role = AdminRole.WAREHOUSE;
    await request(server())
      .post('/api/v1/admin/admins')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({
        email: 'new@example.com',
        password: 'correct horse battery staple',
        role: AdminRole.ORDER_OPS,
      })
      .expect(403);

    await request(server())
      .get('/api/v1/admin/admins')
      .set('Authorization', `Bearer ${token(AuthSubjectType.USER)}`)
      .expect(403);
    await request(server()).get('/api/v1/admin/admins').expect(401);
  });

  it('exposes create and state-changing responses without credential fields', async () => {
    const created = await request(server())
      .post('/api/v1/admin/admins')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-CSRF-Token', 'test-token')
      .send({
        email: 'new@example.com',
        password: 'correct horse battery staple',
        role: AdminRole.ORDER_OPS,
      })
      .expect(201);
    expect(created.headers['cache-control']).toBe('no-store');
    const createdBody = created.body as { data: Record<string, unknown> };
    expect(createdBody.data).not.toHaveProperty('password');

    const disabled = await request(server())
      .post(`/api/v1/admin/admins/${TARGET_ID}/disable`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-CSRF-Token', 'test-token')
      .expect(200);
    expect(disabled.headers['cache-control']).toBe('no-store');
    const disabledBody = disabled.body as { data: Record<string, unknown> };
    expect(disabledBody.data).toMatchObject({
      id: TARGET_ID,
      isActive: false,
    });
  });
});

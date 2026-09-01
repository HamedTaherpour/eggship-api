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
import { Permission } from '../src/common/authz/permission';
import { permissionsForRole } from '../src/common/authz/role-permissions';
import { createOpenApiDocument } from '../src/common/openapi/openapi.document';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import { AuditLogService } from '../src/modules/audit/application/audit-log.service';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../src/modules/audit/domain/audit-event';
import { AuditLogNotFoundError } from '../src/modules/audit/domain/audit-log-errors';
import { AuthSubjectType } from '../src/modules/auth/domain/subject-type';

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

function responseBody<T>(response: { body: unknown }): T {
  return response.body as T;
}

describe('Admin audit logs API (e2e)', () => {
  let app: INestApplication;
  let roles: RoleResolver;
  const adminId = randomUUID();
  const auditId = 'a0000002-0000-4000-8000-000000000002';
  const entityId = 'c1111111-1111-4111-8111-111111111111';
  const listRow = {
    id: auditId,
    occurredAt: new Date('2026-08-12T14:00:00.000Z'),
    actorType: AuditActorType.ADMIN,
    actorId: adminId,
    action: AuditAction.ORDER_CONFIRMED,
    entityType: AuditEntityType.ORDER,
    entityId,
    requestId: 'req_aud03_e2e',
    correlationId: 'aud03-read-test',
    metadata: { changedFields: ['status'] },
  };
  const auditService = {
    listAdmin: jest.fn(),
    getAdminById: jest.fn(),
    append: jest.fn(),
  };

  beforeAll(async () => {
    roles = new RoleResolver();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: (): void => undefined,
        onModuleDestroy: (): void => undefined,
      })
      .overrideProvider(AuditLogService)
      .useValue(auditService)
      .overrideProvider(ADMIN_ROLE_RESOLVER)
      .useValue(roles)
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    roles.role = AdminRole.SUPER_ADMIN;
    auditService.listAdmin.mockResolvedValue({
      data: [listRow],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    auditService.getAdminById.mockResolvedValue(listRow);
  });

  afterAll(async () => app.close());

  const server = (): Server => app.getHttpServer() as Server;
  const adminToken = (): string => token(AuthSubjectType.ADMIN, adminId);

  it('documents list and detail operations in OpenAPI', () => {
    const paths = createOpenApiDocument(app).paths;
    expect(paths['/api/v1/admin/audit-logs']?.get).toBeDefined();
    expect(paths['/api/v1/admin/audit-logs/{id}']?.get).toBeDefined();
  });

  it('grants SUPER_ADMIN access through explicit AUDIT_READ policy, not a role bypass', () => {
    expect(
      permissionsForRole(AdminRole.SUPER_ADMIN).has(Permission.AUDIT_READ),
    ).toBe(true);
    expect(
      permissionsForRole(AdminRole.WAREHOUSE).has(Permission.AUDIT_READ),
    ).toBe(false);
    expect(
      permissionsForRole(AdminRole.ORDER_OPS).has(Permission.AUDIT_READ),
    ).toBe(false);
  });

  it('returns 401 unauthenticated', async () => {
    await request(server()).get('/api/v1/admin/audit-logs').expect(401);
    await request(server())
      .get(`/api/v1/admin/audit-logs/${auditId}`)
      .expect(401);
  });

  it('returns 403 for USER subjects', async () => {
    await request(server())
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${token(AuthSubjectType.USER)}`)
      .expect(403);
  });

  it('returns 403 for Admin roles without AUDIT_READ', async () => {
    for (const role of [AdminRole.WAREHOUSE, AdminRole.ORDER_OPS]) {
      roles.role = role;
      await request(server())
        .get('/api/v1/admin/audit-logs')
        .set('Authorization', `Bearer ${adminToken()}`)
        .expect(403);
      await request(server())
        .get(`/api/v1/admin/audit-logs/${auditId}`)
        .set('Authorization', `Bearer ${adminToken()}`)
        .expect(403);
    }
  });

  it('allows Admin with AUDIT_READ and returns the standard paginated envelope', async () => {
    const response = await request(server())
      .get(
        `/api/v1/admin/audit-logs?action=${AuditAction.ORDER_CONFIRMED}&entityId=${entityId}&sortBy=occurredAt&sortOrder=desc&page=1&pageSize=10`,
      )
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(200);

    const body = responseBody<{
      data: Array<Record<string, unknown>>;
      meta: Record<string, unknown>;
    }>(response);
    expect(body.meta).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    });
    expect(body.data[0]).toMatchObject({
      id: auditId,
      action: AuditAction.ORDER_CONFIRMED,
      entityId,
      requestId: 'req_aud03_e2e',
    });
    expect(body.data[0]).not.toHaveProperty('metadata');
    expect(auditService.listAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.ORDER_CONFIRMED,
        entityId,
        sortBy: 'occurredAt',
        sortOrder: 'desc',
        page: 1,
        pageSize: 10,
      }),
    );
  });

  it('returns bounded detail metadata and omits internal persistence fields', async () => {
    const response = await request(server())
      .get(`/api/v1/admin/audit-logs/${auditId}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(200);

    const body = responseBody<{ data: Record<string, unknown> }>(response);
    expect(body.data).toMatchObject({
      id: auditId,
      metadata: { changedFields: ['status'] },
    });
    expect(body.data).not.toHaveProperty('createdAt');
    expect(body.data).not.toHaveProperty('updatedAt');
    expect(JSON.stringify(body)).not.toMatch(/password|token|secret/iu);
  });

  it('returns AUDIT_LOG_NOT_FOUND for a missing detail id', async () => {
    auditService.getAdminById.mockRejectedValueOnce(
      new AuditLogNotFoundError(),
    );
    const response = await request(server())
      .get(`/api/v1/admin/audit-logs/${randomUUID()}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(404);
    expect(responseBody<{ error: { code: string } }>(response).error.code).toBe(
      'AUDIT_LOG_NOT_FOUND',
    );
  });

  it('rejects malformed detail ids with the standard validation contract', async () => {
    await request(server())
      .get('/api/v1/admin/audit-logs/not-a-uuid')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(400);
    expect(auditService.getAdminById).not.toHaveBeenCalled();
  });

  it('rejects unknown query parameters, unsupported search, metadata query, and sort columns', async () => {
    const auth = adminToken();
    await request(server())
      .get('/api/v1/admin/audit-logs?unexpected=1')
      .set('Authorization', `Bearer ${auth}`)
      .expect(400);
    await request(server())
      .get('/api/v1/admin/audit-logs?q=order')
      .set('Authorization', `Bearer ${auth}`)
      .expect(400);
    await request(server())
      .get('/api/v1/admin/audit-logs?metadata.status=confirmed')
      .set('Authorization', `Bearer ${auth}`)
      .expect(400);
    await request(server())
      .get('/api/v1/admin/audit-logs?sortBy=action')
      .set('Authorization', `Bearer ${auth}`)
      .expect(400);
    expect(auditService.listAdmin).not.toHaveBeenCalled();
  });

  it('does not invoke append on list or detail reads', async () => {
    const auth = adminToken();
    await request(server())
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${auth}`)
      .expect(200);
    await request(server())
      .get(`/api/v1/admin/audit-logs/${auditId}`)
      .set('Authorization', `Bearer ${auth}`)
      .expect(200);
    expect(auditService.append).not.toHaveBeenCalled();
  });
});

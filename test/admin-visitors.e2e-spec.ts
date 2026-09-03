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
import { AuthSubjectType } from '../src/modules/auth/domain/subject-type';
import { AdminVisitorService } from '../src/modules/visitors/application/admin-visitor.service';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';

class Roles implements AdminRoleResolver {
  role: string = AdminRole.SUPER_ADMIN;
  findAdminAuthorization(adminId: string): Promise<AdminAuthorizationLookup> {
    return Promise.resolve({
      status: 'found',
      record: { adminId, role: this.role, isActive: true },
    });
  }
}

describe('Admin Visitors HTTP (REF-04, e2e)', () => {
  let app: INestApplication;
  let roles: Roles;
  const list = jest.fn();
  const get = jest.fn();
  const listReferrals = jest.fn();
  const adminId = randomUUID();

  beforeAll(async () => {
    roles = new Roles();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: (): void => undefined,
        onModuleDestroy: (): void => undefined,
      })
      .overrideProvider(ADMIN_ROLE_RESOLVER)
      .useValue(roles)
      .overrideProvider(AdminVisitorService)
      .useValue({ list, get, listReferrals })
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    jest.clearAllMocks();
    list.mockResolvedValue({
      data: [
        {
          id: randomUUID(),
          name: 'Promoter',
          referralCode: 'ABCD2345EF',
          isActive: true,
          attributionCount: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    get.mockResolvedValue({
      id: randomUUID(),
      name: 'Promoter',
      referralCode: 'ABCD2345EF',
      isActive: true,
      attributionCount: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    listReferrals.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
  });

  function token(subjectType: string): string {
    return jwt.sign(
      {
        sub: subjectType === AuthSubjectType.ADMIN ? adminId : randomUUID(),
        subjectType,
        sessionId: randomUUID(),
        tokenUse: 'access',
      },
      process.env['JWT_ACCESS_SECRET'] ?? '',
      { algorithm: 'HS256', expiresIn: 900 },
    );
  }
  function server(): Server {
    return app.getHttpServer() as Server;
  }

  it('returns no-store minimized visitor and evidence contracts', async () => {
    const visitorId = randomUUID();
    await request(server())
      .get('/api/v1/admin/visitors')
      .set('Authorization', `Bearer ${token(AuthSubjectType.ADMIN)}`)
      .expect(200)
      .expect((response) => {
        const body = response.body as {
          data: Array<Record<string, unknown>>;
        };
        expect(response.headers['cache-control']).toBe('no-store');
        expect(body.data[0]).toHaveProperty('attributionCount', 1);
        expect(body.data[0]).not.toHaveProperty('passwordHash');
      });
    await request(server())
      .get(`/api/v1/admin/visitors/${visitorId}/referrals`)
      .set('Authorization', `Bearer ${token(AuthSubjectType.ADMIN)}`)
      .expect(200);
  });

  it('denies non-admin subjects and roles without VISITOR_READ', async () => {
    await request(server())
      .get('/api/v1/admin/visitors')
      .set('Authorization', `Bearer ${token(AuthSubjectType.USER)}`)
      .expect(403);
    roles.role = AdminRole.ORDER_OPS;
    await request(server())
      .get('/api/v1/admin/visitors')
      .set('Authorization', `Bearer ${token(AuthSubjectType.ADMIN)}`)
      .expect(403);
  });
});

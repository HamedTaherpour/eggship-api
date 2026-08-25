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
import {
  CommerceOverrideMode,
  type CommerceOverrideInput,
  type CommerceScheduleOverrideRecord,
  type CommerceSettingsInput,
  type CommerceSettingsRecord,
} from '../src/modules/commerce-policy/domain/commerce-policy';
import {
  CommerceOverrideNotFoundError,
  CommercePolicyNotInitializedError,
  CommercePolicyRevisionConflictError,
} from '../src/modules/commerce-policy/domain/commerce-policy-errors';
import {
  CommercePolicyRepository,
  type OverrideMutationResult,
  type PolicyMutationResult,
} from '../src/modules/commerce-policy/infrastructure/commerce-policy.repository';

class RoleResolver implements AdminRoleResolver {
  role: string = AdminRole.SUPER_ADMIN;
  findAdminAuthorization(adminId: string): Promise<AdminAuthorizationLookup> {
    return Promise.resolve({
      status: 'found',
      record: { adminId, role: this.role, isActive: true },
    });
  }
}

class InMemoryCommerceRepository {
  settings: CommerceSettingsRecord | null = null;
  overrides = new Map<string, CommerceScheduleOverrideRecord>();
  reset(): void {
    this.settings = null;
    this.overrides.clear();
  }
  getSettings(): Promise<CommerceSettingsRecord | null> {
    return Promise.resolve(this.settings);
  }
  listOverrides(
    from: string,
    to: string,
  ): Promise<CommerceScheduleOverrideRecord[]> {
    return Promise.resolve(
      [...this.overrides.values()]
        .filter((row) => row.localDate >= from && row.localDate <= to)
        .sort((a, b) => a.localDate.localeCompare(b.localDate)),
    );
  }
  initialize(
    input: CommerceSettingsInput,
    actorId: string,
  ): Promise<CommerceSettingsRecord> {
    if (this.settings !== null)
      throw new CommercePolicyRevisionConflictError(this.settings.revision);
    const now = new Date();
    this.settings = {
      ...input,
      revision: 1,
      createdByAdminId: actorId,
      updatedByAdminId: actorId,
      createdAt: now,
      updatedAt: now,
    };
    return Promise.resolve(this.settings);
  }
  updateSettings(
    input: CommerceSettingsInput,
    expectedRevision: number,
    actorId: string,
  ): Promise<PolicyMutationResult> {
    const current = this.require(expectedRevision);
    const changed =
      current.orderingScheduleEnabled !== input.orderingScheduleEnabled ||
      current.orderingOpensAtLocalMinute !== input.orderingOpensAtLocalMinute ||
      current.orderingClosesAtLocalMinute !==
        input.orderingClosesAtLocalMinute ||
      current.minimumOrderQuantity !== input.minimumOrderQuantity;
    this.settings = changed
      ? {
          ...current,
          ...input,
          revision: current.revision + 1,
          updatedByAdminId: actorId,
          updatedAt: new Date(),
        }
      : current;
    return Promise.resolve({ settings: this.settings, changed });
  }
  putOverride(
    localDate: string,
    input: CommerceOverrideInput,
    expectedRevision: number,
    actorId: string,
  ): Promise<OverrideMutationResult> {
    const current = this.require(expectedRevision);
    const existing = this.overrides.get(localDate);
    const changed =
      existing === undefined ||
      existing.mode !== input.mode ||
      existing.opensAtLocalMinute !== input.opensAtLocalMinute ||
      existing.closesAtLocalMinute !== input.closesAtLocalMinute;
    const now = new Date();
    let override: CommerceScheduleOverrideRecord;
    if (changed) {
      override = {
        id: existing?.id ?? randomUUID(),
        localDate,
        ...input,
        createdByAdminId: existing?.createdByAdminId ?? actorId,
        updatedByAdminId: actorId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
    } else {
      if (existing === undefined)
        throw new Error('Unreachable override state.');
      override = existing;
    }
    this.overrides.set(localDate, override);
    this.settings = changed
      ? {
          ...current,
          revision: current.revision + 1,
          updatedByAdminId: actorId,
          updatedAt: now,
        }
      : current;
    return Promise.resolve({
      settings: this.settings,
      override,
      changed,
      action: changed
        ? existing === undefined
          ? ('created' as const)
          : ('updated' as const)
        : ('unchanged' as const),
    });
  }
  removeOverride(
    localDate: string,
    expectedRevision: number,
    actorId: string,
  ): Promise<PolicyMutationResult> {
    const current = this.require(expectedRevision);
    if (!this.overrides.delete(localDate))
      throw new CommerceOverrideNotFoundError();
    this.settings = {
      ...current,
      revision: current.revision + 1,
      updatedByAdminId: actorId,
      updatedAt: new Date(),
    };
    return Promise.resolve({ settings: this.settings, changed: true });
  }
  private require(expectedRevision: number): CommerceSettingsRecord {
    if (this.settings === null) throw new CommercePolicyNotInitializedError();
    if (this.settings.revision !== expectedRevision)
      throw new CommercePolicyRevisionConflictError(this.settings.revision);
    return this.settings;
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

describe('Admin commerce policy API (e2e)', () => {
  let app: INestApplication;
  let repository: InMemoryCommerceRepository;
  let roles: RoleResolver;
  const adminId = randomUUID();
  beforeAll(async () => {
    repository = new InMemoryCommerceRepository();
    roles = new RoleResolver();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: (): void => undefined,
        onModuleDestroy: (): void => undefined,
      })
      .overrideProvider(CommercePolicyRepository)
      .useValue(repository)
      .overrideProvider(ADMIN_ROLE_RESOLVER)
      .useValue(roles)
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });
  beforeEach(() => {
    repository.reset();
    roles.role = AdminRole.SUPER_ADMIN;
  });
  afterAll(async () => app.close());
  const server = (): Server => app.getHttpServer() as Server;
  const adminToken = (): string => token(AuthSubjectType.ADMIN, adminId);

  it('documents all Admin operations and optimistic concurrency bodies', () => {
    const doc = createOpenApiDocument(app);
    expect(doc.paths['/api/v1/admin/commerce-policy']?.get).toBeDefined();
    expect(
      doc.paths['/api/v1/admin/commerce-policy/initialize']?.post,
    ).toBeDefined();
    expect(
      doc.paths['/api/v1/admin/commerce-policy/settings']?.put,
    ).toBeDefined();
    expect(
      doc.paths['/api/v1/admin/commerce-policy/overrides']?.get,
    ).toBeDefined();
    expect(
      doc.paths['/api/v1/admin/commerce-policy/overrides/{localDate}']?.put,
    ).toBeDefined();
    expect(
      doc.paths['/api/v1/admin/commerce-policy/overrides/{localDate}']?.delete,
    ).toBeDefined();
  });

  it('returns 401 unauthenticated, 403 for USER, and 403 for Admin without permission', async () => {
    await request(server()).get('/api/v1/admin/commerce-policy').expect(401);
    await request(server())
      .get('/api/v1/admin/commerce-policy')
      .set('Authorization', `Bearer ${token(AuthSubjectType.USER)}`)
      .expect(403);
    roles.role = AdminRole.WAREHOUSE;
    await request(server())
      .get('/api/v1/admin/commerce-policy')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(403);
  });

  it('initializes, reads, updates minimum and reports stale revision conflicts', async () => {
    const auth = adminToken();
    const initial = await request(server())
      .post('/api/v1/admin/commerce-policy/initialize')
      .set('Authorization', `Bearer ${auth}`)
      .send({
        orderingScheduleEnabled: true,
        orderingOpensAt: '18:00',
        orderingClosesAt: '02:00',
        minimumOrderQuantity: 5,
        expectedRevision: 0,
      })
      .expect(201);
    expect(
      responseBody<{ data: Record<string, unknown> }>(initial).data,
    ).toMatchObject({
      revision: 1,
      orderingOpensAt: '18:00',
      orderingClosesAt: '02:00',
      minimumOrderQuantity: 5,
      createdByAdminId: adminId,
    });
    await request(server())
      .get('/api/v1/admin/commerce-policy')
      .set('Authorization', `Bearer ${auth}`)
      .expect(200);
    const updated = await request(server())
      .put('/api/v1/admin/commerce-policy/settings')
      .set('Authorization', `Bearer ${auth}`)
      .send({
        orderingScheduleEnabled: false,
        orderingOpensAt: '18:00',
        orderingClosesAt: '02:00',
        minimumOrderQuantity: 9,
        expectedRevision: 1,
      })
      .expect(200);
    expect(
      responseBody<{ data: Record<string, unknown> }>(updated).data,
    ).toMatchObject({
      revision: 2,
      minimumOrderQuantity: 9,
      orderingScheduleEnabled: false,
    });
    const conflict = await request(server())
      .put('/api/v1/admin/commerce-policy/settings')
      .set('Authorization', `Bearer ${auth}`)
      .send({
        orderingScheduleEnabled: true,
        orderingOpensAt: '07:00',
        orderingClosesAt: '16:00',
        minimumOrderQuantity: 3,
        expectedRevision: 1,
      })
      .expect(409);
    expect(
      responseBody<{ error: Record<string, unknown> }>(conflict).error,
    ).toMatchObject({
      code: 'COMMERCE_POLICY_REVISION_CONFLICT',
      details: { revision: 2 },
    });
  });

  it('creates, updates, lists, and removes CLOSED/SPECIAL_HOURS overrides', async () => {
    const auth = adminToken();
    await request(server())
      .post('/api/v1/admin/commerce-policy/initialize')
      .set('Authorization', `Bearer ${auth}`)
      .send({
        orderingScheduleEnabled: true,
        orderingOpensAt: '07:00',
        orderingClosesAt: '16:00',
        minimumOrderQuantity: 1,
        expectedRevision: 0,
      })
      .expect(201);
    const closed = await request(server())
      .put('/api/v1/admin/commerce-policy/overrides/2026-08-25')
      .set('Authorization', `Bearer ${auth}`)
      .send({ mode: CommerceOverrideMode.CLOSED, expectedRevision: 1 })
      .expect(200);
    expect(
      responseBody<{ data: Record<string, unknown> }>(closed).data,
    ).toMatchObject({
      revision: 2,
      override: { mode: 'CLOSED', opensAt: null },
    });
    const special = await request(server())
      .put('/api/v1/admin/commerce-policy/overrides/2026-08-25')
      .set('Authorization', `Bearer ${auth}`)
      .send({
        mode: CommerceOverrideMode.SPECIAL_HOURS,
        opensAt: '18:00',
        closesAt: '02:00',
        expectedRevision: 2,
      })
      .expect(200);
    expect(
      responseBody<{ data: Record<string, unknown> }>(special).data,
    ).toMatchObject({
      revision: 3,
      override: { opensAt: '18:00', closesAt: '02:00' },
    });
    const list = await request(server())
      .get(
        '/api/v1/admin/commerce-policy/overrides?from=2026-08-01&to=2026-08-31',
      )
      .set('Authorization', `Bearer ${auth}`)
      .expect(200);
    expect(
      responseBody<{ data: Record<string, unknown> }>(list).data,
    ).toMatchObject({
      revision: 3,
      overrides: [{ localDate: '2026-08-25' }],
    });
    const removed = await request(server())
      .delete('/api/v1/admin/commerce-policy/overrides/2026-08-25')
      .set('Authorization', `Bearer ${auth}`)
      .send({ expectedRevision: 3 })
      .expect(200);
    expect(
      responseBody<{ data: { revision: number } }>(removed).data.revision,
    ).toBe(4);
  });

  it('rejects unknown fields, equal times, and invalid override combinations', async () => {
    const auth = adminToken();
    await request(server())
      .post('/api/v1/admin/commerce-policy/initialize')
      .set('Authorization', `Bearer ${auth}`)
      .send({
        orderingScheduleEnabled: true,
        orderingOpensAt: '07:00',
        orderingClosesAt: '07:00',
        minimumOrderQuantity: 1,
        expectedRevision: 0,
      })
      .expect(400);
    await request(server())
      .post('/api/v1/admin/commerce-policy/initialize')
      .set('Authorization', `Bearer ${auth}`)
      .send({
        orderingScheduleEnabled: true,
        orderingOpensAt: '07:00',
        orderingClosesAt: '16:00',
        minimumOrderQuantity: 1,
        expectedRevision: 0,
        actorId: adminId,
      })
      .expect(400);
    await request(server())
      .post('/api/v1/admin/commerce-policy/initialize')
      .set('Authorization', `Bearer ${auth}`)
      .send({
        orderingScheduleEnabled: true,
        orderingOpensAt: '07:00',
        orderingClosesAt: '16:00',
        minimumOrderQuantity: 1,
        expectedRevision: 0,
      })
      .expect(201);
    const invalid = await request(server())
      .put('/api/v1/admin/commerce-policy/overrides/2026-08-25')
      .set('Authorization', `Bearer ${auth}`)
      .send({
        mode: CommerceOverrideMode.CLOSED,
        opensAt: '07:00',
        expectedRevision: 1,
      })
      .expect(400);
    expect(responseBody<{ error: { code: string } }>(invalid).error.code).toBe(
      'COMMERCE_SCHEDULE_OVERRIDE_INVALID',
    );
  });
});

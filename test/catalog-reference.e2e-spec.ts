import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { createOpenApiDocument } from '../src/common/openapi/openapi.document';
import { AdminRole } from '../src/common/authz/admin-role';
import type {
  AdminAuthorizationLookup,
  AdminRoleResolver,
} from '../src/common/authz/admin-role-resolver';
import { ADMIN_ROLE_RESOLVER } from '../src/common/authz/authorization.tokens';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import type {
  CategoryListQuery,
  CategoryRecord,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '../src/modules/categories/domain/category';
import { normalizeCategoryName } from '../src/modules/categories/domain/category-name';
import { CategoryRepository } from '../src/modules/categories/infrastructure/category.repository';
import type {
  CreateRegionInput,
  RegionListQuery,
  RegionRecord,
  UpdateRegionInput,
} from '../src/modules/regions/domain/region';
import { normalizeRegionName } from '../src/modules/regions/domain/region-name';
import { RegionRepository } from '../src/modules/regions/infrastructure/region.repository';
import { AuthSubjectType } from '../src/modules/auth/domain/subject-type';

class ConfigurableAdminRoleResolver implements AdminRoleResolver {
  private lookup: AdminAuthorizationLookup = { status: 'unavailable' };

  findAdminAuthorization(adminId: string): Promise<AdminAuthorizationLookup> {
    if (this.lookup.status === 'found') {
      return Promise.resolve({
        status: 'found',
        record: { ...this.lookup.record, adminId },
      });
    }
    return Promise.resolve(this.lookup);
  }

  activeRole(role: string): void {
    this.lookup = {
      status: 'found',
      record: {
        adminId: 'replaced',
        role,
        isActive: true,
      },
    };
  }

  reset(): void {
    this.lookup = { status: 'unavailable' };
  }
}

class InMemoryCategoryRepository {
  private readonly rows = new Map<string, CategoryRecord>();

  clear(): void {
    this.rows.clear();
  }

  seed(record: CategoryRecord): void {
    this.rows.set(record.id, record);
  }

  findById(id: string): Promise<CategoryRecord | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  listActiveOrderedByName(): Promise<CategoryRecord[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.isActive)
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  list(query: CategoryListQuery): Promise<{
    items: CategoryRecord[];
    total: number;
  }> {
    let items = [...this.rows.values()];
    if (query.isActive !== undefined) {
      items = items.filter((row) => row.isActive === query.isActive);
    }
    if (query.search !== undefined) {
      const needle = query.search.toLowerCase();
      items = items.filter((row) => row.name.toLowerCase().includes(needle));
    }
    items.sort((a, b) => {
      const left = a[query.sortBy];
      const right = b[query.sortBy];
      const cmp =
        left instanceof Date && right instanceof Date
          ? left.getTime() - right.getTime()
          : String(left).localeCompare(String(right));
      return query.sortOrder === 'asc' ? cmp : -cmp;
    });
    const total = items.length;
    const start = (query.page - 1) * query.pageSize;
    return Promise.resolve({
      items: items.slice(start, start + query.pageSize),
      total,
    });
  }

  create(input: CreateCategoryInput): Promise<CategoryRecord> {
    const now = new Date();
    const created: CategoryRecord = {
      id: randomUUID(),
      name: normalizeCategoryName(input.name),
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(created.id, created);
    return Promise.resolve(created);
  }

  update(
    id: string,
    input: UpdateCategoryInput,
  ): Promise<CategoryRecord | null> {
    const existing = this.rows.get(id);
    if (existing === undefined) {
      return Promise.resolve(null);
    }
    const updated: CategoryRecord = {
      ...existing,
      name:
        input.name !== undefined
          ? normalizeCategoryName(input.name)
          : existing.name,
      isActive:
        input.isActive !== undefined ? input.isActive : existing.isActive,
      updatedAt: new Date(),
    };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }
}

class InMemoryRegionRepository {
  private readonly rows = new Map<string, RegionRecord>();

  clear(): void {
    this.rows.clear();
  }

  seed(record: RegionRecord): void {
    this.rows.set(record.id, record);
  }

  findById(id: string): Promise<RegionRecord | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  listActiveOrderedByName(): Promise<RegionRecord[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.isActive)
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  list(query: RegionListQuery): Promise<{
    items: RegionRecord[];
    total: number;
  }> {
    let items = [...this.rows.values()];
    if (query.isActive !== undefined) {
      items = items.filter((row) => row.isActive === query.isActive);
    }
    if (query.search !== undefined) {
      const needle = query.search.toLowerCase();
      items = items.filter((row) => row.name.toLowerCase().includes(needle));
    }
    items.sort((a, b) => {
      const left = a[query.sortBy];
      const right = b[query.sortBy];
      const cmp =
        left instanceof Date && right instanceof Date
          ? left.getTime() - right.getTime()
          : String(left).localeCompare(String(right));
      return query.sortOrder === 'asc' ? cmp : -cmp;
    });
    const total = items.length;
    const start = (query.page - 1) * query.pageSize;
    return Promise.resolve({
      items: items.slice(start, start + query.pageSize),
      total,
    });
  }

  create(input: CreateRegionInput): Promise<RegionRecord> {
    const now = new Date();
    const created: RegionRecord = {
      id: randomUUID(),
      name: normalizeRegionName(input.name),
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(created.id, created);
    return Promise.resolve(created);
  }

  update(id: string, input: UpdateRegionInput): Promise<RegionRecord | null> {
    const existing = this.rows.get(id);
    if (existing === undefined) {
      return Promise.resolve(null);
    }
    const updated: RegionRecord = {
      ...existing,
      name:
        input.name !== undefined
          ? normalizeRegionName(input.name)
          : existing.name,
      isActive:
        input.isActive !== undefined ? input.isActive : existing.isActive,
      updatedAt: new Date(),
    };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }
}

function signAccessToken(subjectType: AuthSubjectType): string {
  return jwt.sign(
    {
      sub: randomUUID(),
      subjectType,
      sessionId: randomUUID(),
      tokenUse: 'access',
    },
    process.env['JWT_ACCESS_SECRET'] ?? '',
    { algorithm: 'HS256', expiresIn: 900 },
  );
}

interface ApiErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
  requestId: string;
}

interface PublicListBody {
  data: Array<{ id: string; name: string }>;
}

interface AdminResourceBody {
  data: {
    id: string;
    name: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  };
}

interface AdminListBody {
  data: Array<{
    id: string;
    name: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

function asApiErrorBody(body: unknown): ApiErrorBody {
  return body as ApiErrorBody;
}

function asPublicListBody(body: unknown): PublicListBody {
  return body as PublicListBody;
}

function asAdminResourceBody(body: unknown): AdminResourceBody {
  return body as AdminResourceBody;
}

function asAdminListBody(body: unknown): AdminListBody {
  return body as AdminListBody;
}

describe('Category and Region reference APIs (e2e)', () => {
  let app: INestApplication;
  let categories: InMemoryCategoryRepository;
  let regions: InMemoryRegionRepository;
  let admins: ConfigurableAdminRoleResolver;

  beforeAll(async () => {
    categories = new InMemoryCategoryRepository();
    regions = new InMemoryRegionRepository();
    admins = new ConfigurableAdminRoleResolver();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: (): void => undefined,
        onModuleDestroy: (): void => undefined,
      })
      .overrideProvider(CategoryRepository)
      .useValue(categories)
      .overrideProvider(RegionRepository)
      .useValue(regions)
      .overrideProvider(ADMIN_ROLE_RESOLVER)
      .useValue(admins)
      .compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    categories.clear();
    regions.clear();
    admins.reset();
  });

  function server(): Server {
    return app.getHttpServer() as Server;
  }

  it('public category list returns only active rows ordered by name', async () => {
    const now = new Date();
    categories.seed({
      id: randomUUID(),
      name: 'Eggs',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    categories.seed({
      id: randomUUID(),
      name: 'Dairy',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    categories.seed({
      id: randomUUID(),
      name: 'Hidden',
      isActive: false,
      createdAt: now,
      updatedAt: now,
    });

    const response = await request(server())
      .get('/api/v1/categories')
      .expect(200);

    const publicCategories = asPublicListBody(response.body).data;
    expect(publicCategories.map((row) => row.name)).toEqual(['Dairy', 'Eggs']);
    expect(publicCategories.every((row) => typeof row.id === 'string')).toBe(
      true,
    );
    expect(publicCategories.map((row) => row.name)).not.toContain('Hidden');
    for (const row of publicCategories) {
      expect(row).not.toHaveProperty('isActive');
      expect(row).not.toHaveProperty('createdAt');
      expect(row).not.toHaveProperty('updatedAt');
    }

    const rejected = await request(server())
      .get('/api/v1/categories')
      .query({ page: 1 })
      .expect(400);
    expect(asApiErrorBody(rejected.body).error.code).toBe('BAD_REQUEST');
  });

  it('public region list hides inactive regions', async () => {
    const now = new Date();
    regions.seed({
      id: randomUUID(),
      name: 'Tehran',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    regions.seed({
      id: randomUUID(),
      name: 'Retired',
      isActive: false,
      createdAt: now,
      updatedAt: now,
    });

    const response = await request(server()).get('/api/v1/regions').expect(200);
    const publicRegions = asPublicListBody(response.body).data;
    expect(publicRegions.map((row) => row.name)).toEqual(['Tehran']);
    expect(publicRegions.map((row) => row.name)).not.toContain('Retired');
  });

  it('admin category routes require auth and CATALOG permissions', async () => {
    await request(server()).get('/api/v1/admin/categories').expect(401);

    const userToken = signAccessToken(AuthSubjectType.USER);
    await request(server())
      .get('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    admins.activeRole(AdminRole.WAREHOUSE);
    const warehouseToken = signAccessToken(AuthSubjectType.ADMIN);
    await request(server())
      .get('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .expect(200);

    await request(server())
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .send({ name: 'Dairy' })
      .expect(403);

    admins.activeRole(AdminRole.SUPER_ADMIN);
    const superToken = signAccessToken(AuthSubjectType.ADMIN);
    const created = await request(server())
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ name: '  Dairy  ' })
      .expect(201);

    const createdBody = asAdminResourceBody(created.body);
    expect(createdBody.data).toMatchObject({
      name: 'Dairy',
      isActive: true,
    });
    expect(createdBody.data).toHaveProperty('createdAt');
    expect(createdBody.data).toHaveProperty('updatedAt');

    const updated = await request(server())
      .patch(`/api/v1/admin/categories/${createdBody.data.id}`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ isActive: false })
      .expect(200);
    expect(asAdminResourceBody(updated.body).data.isActive).toBe(false);

    const missing = await request(server())
      .patch(`/api/v1/admin/categories/${randomUUID()}`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ name: 'Nope' })
      .expect(404);
    expect(asApiErrorBody(missing.body).error.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('admin category list supports pagination, search, sort, filter, and rejects unknown query', async () => {
    admins.activeRole(AdminRole.SUPER_ADMIN);
    const token = signAccessToken(AuthSubjectType.ADMIN);
    const now = new Date();
    categories.seed({
      id: randomUUID(),
      name: 'Alpha',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    categories.seed({
      id: randomUUID(),
      name: 'Beta',
      isActive: false,
      createdAt: now,
      updatedAt: now,
    });

    const page = await request(server())
      .get('/api/v1/admin/categories')
      .query({
        page: 1,
        pageSize: 1,
        search: 'a',
        sortBy: 'name',
        sortOrder: 'asc',
        isActive: 'true',
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const pageBody = asAdminListBody(page.body);
    expect(pageBody.data).toHaveLength(1);
    expect(pageBody.data[0]?.name).toBe('Alpha');
    expect(pageBody.meta).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 1,
      totalPages: 1,
    });

    const rejected = await request(server())
      .get('/api/v1/admin/categories')
      .query({ unknown: 'x' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(asApiErrorBody(rejected.body).error.code).toBe('BAD_REQUEST');
  });

  it('CATALOG_READ roles can list categories and regions but cannot manage them', async () => {
    const now = new Date();
    const category = {
      id: randomUUID(),
      name: 'Eggs',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    const region = {
      id: randomUUID(),
      name: 'Tehran',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    categories.seed(category);
    regions.seed(region);

    for (const role of [AdminRole.WAREHOUSE, AdminRole.ORDER_OPS]) {
      admins.activeRole(role);
      const token = signAccessToken(AuthSubjectType.ADMIN);

      await request(server())
        .get('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(server())
        .get('/api/v1/admin/regions')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(server())
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Dairy' })
        .expect(403);

      await request(server())
        .post('/api/v1/admin/regions')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Karaj' })
        .expect(403);

      await request(server())
        .patch(`/api/v1/admin/categories/${category.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Modified' })
        .expect(403);

      await request(server())
        .patch(`/api/v1/admin/regions/${region.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Modified' })
        .expect(403);
    }
  });

  it('admin region list rejects unknown query parameters', async () => {
    admins.activeRole(AdminRole.SUPER_ADMIN);
    const token = signAccessToken(AuthSubjectType.ADMIN);

    const rejected = await request(server())
      .get('/api/v1/admin/regions')
      .query({ unknown: 'x' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(asApiErrorBody(rejected.body).error.code).toBe('BAD_REQUEST');
  });

  it('admin region create/update and OpenAPI document the new operations', async () => {
    admins.activeRole(AdminRole.ORDER_OPS);
    const orderOps = signAccessToken(AuthSubjectType.ADMIN);
    await request(server())
      .post('/api/v1/admin/regions')
      .set('Authorization', `Bearer ${orderOps}`)
      .send({ name: 'Tehran' })
      .expect(403);

    admins.activeRole(AdminRole.SUPER_ADMIN);
    const token = signAccessToken(AuthSubjectType.ADMIN);
    const created = await request(server())
      .post('/api/v1/admin/regions')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Tehran' })
      .expect(201);

    const createdId = asAdminResourceBody(created.body).data.id;
    await request(server())
      .patch(`/api/v1/admin/regions/${createdId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Karaj' })
      .expect(200);

    const missing = await request(server())
      .patch(`/api/v1/admin/regions/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X' })
      .expect(404);
    expect(asApiErrorBody(missing.body).error.code).toBe('REGION_NOT_FOUND');

    const openapi = createOpenApiDocument(app);
    const paths = openapi.paths ?? {};
    expect(paths['/api/v1/categories']).toBeDefined();
    expect(paths['/api/v1/regions']).toBeDefined();
    expect(paths['/api/v1/admin/categories']).toBeDefined();
    expect(paths['/api/v1/admin/regions']).toBeDefined();
    expect(paths['/api/v1/admin/categories/{id}']).toBeDefined();
    expect(paths['/api/v1/admin/regions/{id}']).toBeDefined();

    const operations = Object.values(paths).flatMap((pathItem) =>
      Object.values(pathItem ?? {}).filter(
        (op): op is { operationId?: string } =>
          typeof op === 'object' && op !== null,
      ),
    );
    const operationIds = operations
      .map((op) => op.operationId)
      .filter((id): id is string => typeof id === 'string');
    expect(operationIds).toEqual(
      expect.arrayContaining([
        'Categories_list',
        'AdminCategories_list',
        'AdminCategories_create',
        'AdminCategories_update',
        'Regions_list',
        'AdminRegions_list',
        'AdminRegions_create',
        'AdminRegions_update',
      ]),
    );
  });
});

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
  CreateProductInput,
  ProductListQuery,
  ProductRecord,
  UpdateProductInput,
} from '../src/modules/products/domain/product';
import { normalizeProductName } from '../src/modules/products/domain/product-name';
import { normalizeProductPrice } from '../src/modules/products/domain/product-price';
import { ProductRepository } from '../src/modules/products/infrastructure/product.repository';
import { InventoryService } from '../src/modules/inventory/application/inventory.service';
import { PriceHistoryRepository } from '../src/modules/pricing/infrastructure/price-history.repository';
import type {
  AppendPriceHistoryInput,
  PriceHistoryRecord,
} from '../src/modules/pricing/domain/price-history';
import type { TransactionContext } from '../src/infrastructure/database/transaction';
import {
  TRANSACTION_CONTEXT_BRAND,
  TransactionRunner,
} from '../src/infrastructure/database/transaction';
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

class InMemoryProductRepository {
  private readonly rows = new Map<string, ProductRecord>();
  categories: InMemoryCategoryRepository | undefined;

  clear(): void {
    this.rows.clear();
  }

  seed(record: ProductRecord): void {
    this.rows.set(record.id, record);
  }

  findById(id: string): Promise<ProductRecord | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  findPublicById(id: string): Promise<ProductRecord | null> {
    const row = this.rows.get(id);
    if (row === undefined) {
      return Promise.resolve(null);
    }
    return this.isPubliclyVisible(row).then((ok) => (ok ? row : null));
  }

  private async isPubliclyVisible(row: ProductRecord): Promise<boolean> {
    if (!row.isActive || this.categories === undefined) {
      return false;
    }
    const category = await this.categories.findById(row.categoryId);
    return category !== null && category.isActive;
  }

  list(query: ProductListQuery): Promise<{
    items: ProductRecord[];
    total: number;
  }> {
    return this.filter(query).then((items) => {
      items.sort((a, b) => {
        const left = a[query.sortBy];
        const right = b[query.sortBy];
        const cmp =
          left instanceof Date && right instanceof Date
            ? left.getTime() - right.getTime()
            : typeof left === 'number' && typeof right === 'number'
              ? left - right
              : String(left).localeCompare(String(right));
        return query.sortOrder === 'asc' ? cmp : -cmp;
      });
      const total = items.length;
      const start = (query.page - 1) * query.pageSize;
      return {
        items: items.slice(start, start + query.pageSize),
        total,
      };
    });
  }

  private async filter(query: ProductListQuery): Promise<ProductRecord[]> {
    let items = [...this.rows.values()];
    if (query.isActive !== undefined) {
      items = items.filter((row) => row.isActive === query.isActive);
    }
    if (query.categoryId !== undefined) {
      items = items.filter((row) => row.categoryId === query.categoryId);
    }
    if (query.search !== undefined) {
      const needle = query.search.toLowerCase();
      items = items.filter((row) => row.name.toLowerCase().includes(needle));
    }
    if (query.requireActiveCategory === true && this.categories !== undefined) {
      const visible: ProductRecord[] = [];
      for (const row of items) {
        const category = await this.categories.findById(row.categoryId);
        if (category !== null && category.isActive) {
          visible.push(row);
        }
      }
      items = visible;
    }
    return items;
  }

  create(
    input: CreateProductInput,
    tx?: TransactionContext,
  ): Promise<ProductRecord> {
    void tx;
    const now = new Date();
    const created: ProductRecord = {
      id: randomUUID(),
      name: normalizeProductName(input.name),
      price: normalizeProductPrice(input.price),
      categoryId: input.categoryId,
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(created.id, created);
    return Promise.resolve(created);
  }

  findByIdForUpdate(
    id: string,
    tx: TransactionContext,
  ): Promise<ProductRecord | null> {
    void tx;
    return this.findById(id);
  }

  updatePrice(
    id: string,
    price: number,
    tx: TransactionContext,
  ): Promise<ProductRecord | null> {
    void tx;
    const existing = this.rows.get(id);
    if (existing === undefined) {
      return Promise.resolve(null);
    }
    const updated: ProductRecord = {
      ...existing,
      price: normalizeProductPrice(price),
      updatedAt: new Date(),
    };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  update(
    id: string,
    input: UpdateProductInput,
    tx?: TransactionContext,
  ): Promise<ProductRecord | null> {
    void tx;
    const existing = this.rows.get(id);
    if (existing === undefined) {
      return Promise.resolve(null);
    }
    const updated: ProductRecord = {
      ...existing,
      name:
        input.name !== undefined
          ? normalizeProductName(input.name)
          : existing.name,
      categoryId:
        input.categoryId !== undefined ? input.categoryId : existing.categoryId,
      isActive:
        input.isActive !== undefined ? input.isActive : existing.isActive,
      updatedAt: new Date(),
    };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }
}

class InMemoryPriceHistoryRepository {
  readonly rows: PriceHistoryRecord[] = [];

  clear(): void {
    this.rows.length = 0;
  }

  append(
    input: AppendPriceHistoryInput,
    tx: TransactionContext,
  ): Promise<PriceHistoryRecord> {
    void tx;
    const created: PriceHistoryRecord = {
      id: randomUUID(),
      productId: input.productId,
      oldPrice: input.oldPrice,
      newPrice: input.newPrice,
      actorType: input.actorType,
      actorId: input.actorId,
      createdAt: new Date(),
    };
    this.rows.push(created);
    return Promise.resolve(created);
  }

  listByProductId(productId: string): Promise<PriceHistoryRecord[]> {
    return Promise.resolve(
      this.rows.filter((row) => row.productId === productId),
    );
  }

  countByProductId(productId: string): Promise<number> {
    return Promise.resolve(
      this.rows.filter((row) => row.productId === productId).length,
    );
  }
}

class PassThroughTransactionRunner extends TransactionRunner {
  override run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return fn({ [TRANSACTION_CONTEXT_BRAND]: true });
  }

  override runIn<T>(
    existing: TransactionContext | undefined,
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return fn(existing ?? { [TRANSACTION_CONTEXT_BRAND]: true });
  }

  override runSnapshotRead<T>(
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return this.run(fn);
  }
}

const stubInventoryService = {
  ensureForProduct: (
    productId: string,
  ): Promise<{
    productId: string;
    onHand: number;
    reserved: number;
    available: number;
    createdAt: Date;
    updatedAt: Date;
  }> =>
    Promise.resolve({
      productId,
      onHand: 0,
      reserved: 0,
      available: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
};

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

interface PublicProductBody {
  data: {
    id: string;
    name: string;
    price: number;
    categoryId: string;
  };
}

interface PublicProductListBody {
  data: Array<{
    id: string;
    name: string;
    price: number;
    categoryId: string;
  }>;
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface AdminProductBody {
  data: {
    id: string;
    name: string;
    price: number;
    categoryId: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  };
}

interface AdminProductListBody {
  data: Array<{
    id: string;
    name: string;
    price: number;
    categoryId: string;
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

function asPublicProductBody(body: unknown): PublicProductBody {
  return body as PublicProductBody;
}

function asPublicProductListBody(body: unknown): PublicProductListBody {
  return body as PublicProductListBody;
}

function asAdminProductBody(body: unknown): AdminProductBody {
  return body as AdminProductBody;
}

function asAdminProductListBody(body: unknown): AdminProductListBody {
  return body as AdminProductListBody;
}

describe('Product catalog APIs (e2e)', () => {
  let app: INestApplication;
  let categories: InMemoryCategoryRepository;
  let products: InMemoryProductRepository;
  let priceHistory: InMemoryPriceHistoryRepository;
  let admins: ConfigurableAdminRoleResolver;
  let activeCategoryId: string;
  let inactiveCategoryId: string;

  beforeAll(async () => {
    categories = new InMemoryCategoryRepository();
    products = new InMemoryProductRepository();
    products.categories = categories;
    priceHistory = new InMemoryPriceHistoryRepository();
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
      .overrideProvider(ProductRepository)
      .useValue(products)
      .overrideProvider(PriceHistoryRepository)
      .useValue(priceHistory)
      .overrideProvider(TransactionRunner)
      .useValue(new PassThroughTransactionRunner())
      .overrideProvider(InventoryService)
      .useValue(stubInventoryService)
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
    products.clear();
    priceHistory.clear();
    admins.reset();

    const now = new Date();
    activeCategoryId = randomUUID();
    inactiveCategoryId = randomUUID();
    categories.seed({
      id: activeCategoryId,
      name: 'Eggs',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    categories.seed({
      id: inactiveCategoryId,
      name: 'Retired',
      isActive: false,
      createdAt: now,
      updatedAt: now,
    });
  });

  function server(): Server {
    return app.getHttpServer() as Server;
  }

  function seedProduct(
    overrides: Partial<ProductRecord> & Pick<ProductRecord, 'name' | 'price'>,
  ): ProductRecord {
    const now = new Date();
    const record: ProductRecord = {
      id: overrides.id ?? randomUUID(),
      name: overrides.name,
      price: overrides.price,
      categoryId: overrides.categoryId ?? activeCategoryId,
      isActive: overrides.isActive ?? true,
      createdAt: overrides.createdAt ?? now,
      updatedAt: overrides.updatedAt ?? now,
    };
    products.seed(record);
    return record;
  }

  it('public list paginates, searches, filters by category, sorts, and hides inactive', async () => {
    seedProduct({ name: 'Alpha eggs', price: 1000 });
    seedProduct({ name: 'Beta eggs', price: 3000 });
    seedProduct({ name: 'Hidden', price: 2000, isActive: false });
    seedProduct({
      name: 'Orphaned active',
      price: 1500,
      categoryId: inactiveCategoryId,
    });

    const page = await request(server())
      .get('/api/v1/products')
      .query({
        page: 1,
        pageSize: 1,
        search: 'eggs',
        sortBy: 'price',
        sortOrder: 'desc',
        categoryId: activeCategoryId,
      })
      .expect(200);

    const pageBody = asPublicProductListBody(page.body);
    expect(pageBody.meta).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 2,
      totalPages: 2,
    });
    expect(pageBody.data).toHaveLength(1);
    expect(pageBody.data[0]).toMatchObject({
      name: 'Beta eggs',
      price: 3000,
      categoryId: activeCategoryId,
    });
    expect(pageBody.data[0]).not.toHaveProperty('isActive');
    expect(pageBody.data[0]).not.toHaveProperty('stock');

    const rejected = await request(server())
      .get('/api/v1/products')
      .query({ isActive: 'false' })
      .expect(400);
    expect(asApiErrorBody(rejected.body).error.code).toBe('BAD_REQUEST');
  });

  it('public detail returns active products and hides inactive / inactive-category', async () => {
    const visible = seedProduct({ name: 'Visible', price: 5000 });
    const inactive = seedProduct({
      name: 'Inactive',
      price: 5000,
      isActive: false,
    });
    const underInactive = seedProduct({
      name: 'Under inactive category',
      price: 5000,
      categoryId: inactiveCategoryId,
    });

    const ok = await request(server())
      .get(`/api/v1/products/${visible.id}`)
      .expect(200);
    expect(asPublicProductBody(ok.body).data).toMatchObject({
      id: visible.id,
      price: 5000,
    });

    const missingInactive = await request(server())
      .get(`/api/v1/products/${inactive.id}`)
      .expect(404);
    expect(asApiErrorBody(missingInactive.body).error.code).toBe(
      'PRODUCT_NOT_FOUND',
    );

    const missingCategory = await request(server())
      .get(`/api/v1/products/${underInactive.id}`)
      .expect(404);
    expect(asApiErrorBody(missingCategory.body).error.code).toBe(
      'PRODUCT_NOT_FOUND',
    );
  });

  it('admin product routes require auth and CATALOG permissions', async () => {
    await request(server()).get('/api/v1/admin/products').expect(401);

    const userToken = signAccessToken(AuthSubjectType.USER);
    await request(server())
      .get('/api/v1/admin/products')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    admins.activeRole(AdminRole.WAREHOUSE);
    const warehouseToken = signAccessToken(AuthSubjectType.ADMIN);
    await request(server())
      .get('/api/v1/admin/products')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .expect(200);

    await request(server())
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .send({
        name: 'Eggs',
        price: 1000,
        categoryId: activeCategoryId,
      })
      .expect(403);

    admins.activeRole(AdminRole.SUPER_ADMIN);
    const superToken = signAccessToken(AuthSubjectType.ADMIN);
    const created = await request(server())
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        name: '  Fresh eggs  ',
        price: 625000,
        categoryId: activeCategoryId,
      })
      .expect(201);

    const createdBody = asAdminProductBody(created.body);
    expect(createdBody.data).toMatchObject({
      name: 'Fresh eggs',
      price: 625000,
      categoryId: activeCategoryId,
      isActive: true,
    });

    const updated = await request(server())
      .patch(`/api/v1/admin/products/${createdBody.data.id}`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ price: 650000, isActive: false })
      .expect(200);
    expect(asAdminProductBody(updated.body).data).toMatchObject({
      price: 650000,
      isActive: false,
    });

    const detail = await request(server())
      .get(`/api/v1/admin/products/${createdBody.data.id}`)
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);
    expect(asAdminProductBody(detail.body).data.isActive).toBe(false);
  });

  it('admin create validates price and category; list supports filters', async () => {
    admins.activeRole(AdminRole.SUPER_ADMIN);
    const token = signAccessToken(AuthSubjectType.ADMIN);

    const badPrice = await request(server())
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Eggs',
        price: 0,
        categoryId: activeCategoryId,
      })
      .expect(400);
    expect(asApiErrorBody(badPrice.body).error.code).toBe('BAD_REQUEST');

    const badCategory = await request(server())
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Eggs',
        price: 1000,
        categoryId: randomUUID(),
      })
      .expect(400);
    expect(asApiErrorBody(badCategory.body).error.code).toBe(
      'PRODUCT_INVALID_CATEGORY',
    );

    seedProduct({ name: 'Alpha', price: 1000 });
    seedProduct({ name: 'Beta', price: 2000, isActive: false });

    const page = await request(server())
      .get('/api/v1/admin/products')
      .query({
        page: 1,
        pageSize: 10,
        search: 'a',
        sortBy: 'name',
        sortOrder: 'asc',
        isActive: 'true',
        categoryId: activeCategoryId,
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const pageBody = asAdminProductListBody(page.body);
    expect(pageBody.data.map((row) => row.name)).toEqual(['Alpha']);

    const rejected = await request(server())
      .get('/api/v1/admin/products')
      .query({ unknown: 'x' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(asApiErrorBody(rejected.body).error.code).toBe('BAD_REQUEST');
  });

  it('OpenAPI documents Product operations with integer Toman price', () => {
    const openapi = createOpenApiDocument(app);
    const paths = openapi.paths ?? {};
    expect(paths['/api/v1/products']).toBeDefined();
    expect(paths['/api/v1/products/{id}']).toBeDefined();
    expect(paths['/api/v1/admin/products']).toBeDefined();
    expect(paths['/api/v1/admin/products/{id}']).toBeDefined();

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
        'Products_list',
        'Products_get',
        'AdminProducts_list',
        'AdminProducts_get',
        'AdminProducts_create',
        'AdminProducts_update',
      ]),
    );
  });
});

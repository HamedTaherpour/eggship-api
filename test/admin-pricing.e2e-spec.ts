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
import {
  TRANSACTION_CONTEXT_BRAND,
  TransactionRunner,
  type TransactionContext,
} from '../src/infrastructure/database/transaction';
import { AuditLogService } from '../src/modules/audit/application/audit-log.service';
import type {
  CategoryListQuery,
  CategoryRecord,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '../src/modules/categories/domain/category';
import { normalizeCategoryName } from '../src/modules/categories/domain/category-name';
import { CategoryRepository } from '../src/modules/categories/infrastructure/category.repository';
import {
  DiscountTarget,
  DiscountType,
  type CreateDiscountInput,
  type DiscountListQuery,
  type DiscountPayload,
  type DiscountRecord,
} from '../src/modules/pricing/domain/discount';
import { buildDiscountPayload } from '../src/modules/pricing/domain/discount-lifecycle';
import { normalizeDiscountName } from '../src/modules/pricing/domain/discount-name';
import { DiscountRepository } from '../src/modules/pricing/infrastructure/discount.repository';
import type {
  AppendPriceHistoryInput,
  PriceHistoryListQuery,
  PriceHistoryRecord,
} from '../src/modules/pricing/domain/price-history';
import { PriceHistoryRepository } from '../src/modules/pricing/infrastructure/price-history.repository';
import type {
  CreateProductInput,
  ProductListQuery,
  ProductRecord,
  UpdateProductInput,
} from '../src/modules/products/domain/product';
import { normalizeProductName } from '../src/modules/products/domain/product-name';
import { normalizeProductPrice } from '../src/modules/products/domain/product-price';
import { ProductRepository } from '../src/modules/products/infrastructure/product.repository';
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
  readonly rows = new Map<string, ProductRecord>();
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

  list(query: ProductListQuery): Promise<{
    items: ProductRecord[];
    total: number;
  }> {
    void query;
    return Promise.resolve({ items: [], total: 0 });
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

  listByProductPaginated(
    query: PriceHistoryListQuery,
  ): Promise<{ items: PriceHistoryRecord[]; total: number }> {
    const items = this.rows
      .filter((row) => row.productId === query.productId)
      .sort((a, b) => {
        const byTime = b.createdAt.getTime() - a.createdAt.getTime();
        if (byTime !== 0) {
          return byTime;
        }
        return b.id.localeCompare(a.id);
      });
    const total = items.length;
    const start = (query.page - 1) * query.pageSize;
    return Promise.resolve({
      items: items.slice(start, start + query.pageSize),
      total,
    });
  }
}

class InMemoryDiscountRepository {
  private readonly rows = new Map<string, DiscountRecord>();

  clear(): void {
    this.rows.clear();
  }

  findById(id: string): Promise<DiscountRecord | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  list(query: DiscountListQuery): Promise<{
    items: DiscountRecord[];
    total: number;
  }> {
    let items = [...this.rows.values()];
    if (query.isActive !== undefined) {
      items = items.filter((row) => row.isActive === query.isActive);
    }
    if (query.type !== undefined) {
      items = items.filter((row) => row.type === query.type);
    }
    if (query.target !== undefined) {
      items = items.filter((row) => row.target === query.target);
    }
    if (query.search !== undefined) {
      const needle = query.search.toLowerCase();
      items = items.filter((row) => row.name.toLowerCase().includes(needle));
    }
    items.sort((a, b) => {
      const field = query.sortBy;
      const left = a[field];
      const right = b[field];
      const cmp =
        left instanceof Date && right instanceof Date
          ? left.getTime() - right.getTime()
          : String(left).localeCompare(String(right));
      const primary = query.sortOrder === 'asc' ? cmp : -cmp;
      if (primary !== 0) {
        return primary;
      }
      return query.sortOrder === 'asc'
        ? a.id.localeCompare(b.id)
        : b.id.localeCompare(a.id);
    });
    const total = items.length;
    const start = (query.page - 1) * query.pageSize;
    return Promise.resolve({
      items: items.slice(start, start + query.pageSize),
      total,
    });
  }

  create(payload: DiscountPayload): Promise<DiscountRecord> {
    const now = new Date();
    const created: DiscountRecord = {
      id: randomUUID(),
      ...payload,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(created.id, created);
    return Promise.resolve(created);
  }

  update(id: string, payload: DiscountPayload): Promise<DiscountRecord | null> {
    const existing = this.rows.get(id);
    if (existing === undefined) {
      return Promise.resolve(null);
    }
    const updated: DiscountRecord = {
      ...existing,
      ...payload,
      updatedAt: new Date(),
    };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  seedFromInput(input: CreateDiscountInput): DiscountRecord {
    const payload = buildDiscountPayload({
      name: normalizeDiscountName(input.name),
      type: input.type,
      target: input.target,
      percentValue: input.percentValue,
      fixedAmount: input.fixedAmount,
      productId: input.productId,
      categoryId: input.categoryId,
      isActive: input.isActive ?? true,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      precedence: input.precedence ?? 0,
      maxQuantityPerCustomer: input.maxQuantityPerCustomer,
    });
    const now = new Date();
    const record: DiscountRecord = {
      id: randomUUID(),
      ...payload,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(record.id, record);
    return record;
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

  override runRepeatableRead<T>(
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return this.run(fn);
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
  error: { code: string; message: string };
}

function asApiErrorBody(body: unknown): ApiErrorBody {
  return body as ApiErrorBody;
}

interface DiscountListBody {
  data: Array<{ id: string; name: string; isActive: boolean; type: string }>;
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

function asDiscountListBody(body: unknown): DiscountListBody {
  return body as DiscountListBody;
}

interface DiscountBody {
  data: {
    id: string;
    name: string;
    type: string;
    target: string;
    isActive: boolean;
    percentValue: number | null;
    fixedAmount: number | null;
    maxQuantityPerCustomer: number | null;
  };
}

function asDiscountBody(body: unknown): DiscountBody {
  return body as DiscountBody;
}

interface PriceHistoryListBody {
  data: Array<{ oldPrice: number; newPrice: number; createdAt: string }>;
  meta: { total: number };
}

function asPriceHistoryListBody(body: unknown): PriceHistoryListBody {
  return body as PriceHistoryListBody;
}

interface PriceChangeBody {
  data: { price: number; historyWritten: boolean };
}

function asPriceChangeBody(body: unknown): PriceChangeBody {
  return body as PriceChangeBody;
}

describe('Admin pricing and discount APIs (e2e)', () => {
  let app: INestApplication;
  let categories: InMemoryCategoryRepository;
  let products: InMemoryProductRepository;
  let priceHistory: InMemoryPriceHistoryRepository;
  let discounts: InMemoryDiscountRepository;
  let admins: ConfigurableAdminRoleResolver;
  let activeCategoryId: string;
  let adminId: string;

  beforeAll(async () => {
    categories = new InMemoryCategoryRepository();
    products = new InMemoryProductRepository();
    products.categories = categories;
    priceHistory = new InMemoryPriceHistoryRepository();
    discounts = new InMemoryDiscountRepository();
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
      .overrideProvider(DiscountRepository)
      .useValue(discounts)
      .overrideProvider(TransactionRunner)
      .useValue(new PassThroughTransactionRunner())
      .overrideProvider(AuditLogService)
      .useValue({ append: jest.fn().mockResolvedValue(undefined) })
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
    discounts.clear();
    admins.reset();

    const now = new Date();
    activeCategoryId = randomUUID();
    adminId = randomUUID();
    categories.seed({
      id: activeCategoryId,
      name: 'Eggs',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  function server(): Server {
    return app.getHttpServer() as Server;
  }

  function signAdmin(role: AdminRole = AdminRole.SUPER_ADMIN): string {
    admins.activeRole(role);
    return jwt.sign(
      {
        sub: adminId,
        subjectType: AuthSubjectType.ADMIN,
        sessionId: randomUUID(),
        tokenUse: 'access',
      },
      process.env['JWT_ACCESS_SECRET'] ?? '',
      { algorithm: 'HS256', expiresIn: 900 },
    );
  }

  function seedProduct(price = 1000): string {
    const now = new Date();
    const productId = randomUUID();
    products.seed({
      id: productId,
      name: 'Fresh eggs',
      price,
      categoryId: activeCategoryId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return productId;
  }

  it('documents AdminPricing and AdminDiscounts operations in OpenAPI', () => {
    const doc = createOpenApiDocument(app);
    expect(
      doc.paths['/api/v1/admin/pricing/products/{productId}/price-history']
        ?.get,
    ).toBeDefined();
    expect(
      doc.paths['/api/v1/admin/pricing/products/{productId}/price']?.patch,
    ).toBeDefined();
    expect(doc.paths['/api/v1/admin/discounts']?.get).toBeDefined();
    expect(doc.paths['/api/v1/admin/discounts']?.post).toBeDefined();
    expect(doc.paths['/api/v1/admin/discounts/{id}']?.patch).toBeDefined();
    expect(
      doc.paths['/api/v1/admin/discounts/{id}/activate']?.post,
    ).toBeDefined();
    expect(
      doc.paths['/api/v1/admin/discounts/{id}/deactivate']?.post,
    ).toBeDefined();
  });

  it('requires authentication and DISCOUNT permissions', async () => {
    await request(server()).get('/api/v1/admin/discounts').expect(401);

    const userToken = signAccessToken(AuthSubjectType.USER);
    await request(server())
      .get('/api/v1/admin/discounts')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    admins.activeRole(AdminRole.WAREHOUSE);
    const warehouseToken = signAccessToken(AuthSubjectType.ADMIN);
    await request(server())
      .get('/api/v1/admin/discounts')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .expect(403);

    const productId = seedProduct();
    await request(server())
      .get(`/api/v1/admin/pricing/products/${productId}/price-history`)
      .set('Authorization', `Bearer ${warehouseToken}`)
      .expect(403);

    admins.activeRole(AdminRole.SUPER_ADMIN);
    const superToken = signAdmin();
    await request(server())
      .get('/api/v1/admin/discounts')
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);
  });

  it('lists, filters, sorts, and searches discounts', async () => {
    const token = signAdmin();
    discounts.seedFromInput({
      name: 'Alpha order',
      type: DiscountType.PERCENT,
      target: DiscountTarget.ORDER,
      percentValue: 5,
      precedence: 1,
    });
    discounts.seedFromInput({
      name: 'Beta product',
      type: DiscountType.FIXED,
      target: DiscountTarget.ORDER,
      fixedAmount: 1000,
      isActive: false,
      precedence: 2,
    });

    const activeOnly = await request(server())
      .get('/api/v1/admin/discounts')
      .query({ isActive: 'true' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(asDiscountListBody(activeOnly.body).meta.total).toBe(1);

    const search = await request(server())
      .get('/api/v1/admin/discounts')
      .query({ search: 'beta' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(asDiscountListBody(search.body).data[0]?.name).toBe('Beta product');

    const sorted = await request(server())
      .get('/api/v1/admin/discounts')
      .query({ sortBy: 'precedence', sortOrder: 'desc' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(asDiscountListBody(sorted.body).data[0]?.name).toBe('Beta product');

    await request(server())
      .get('/api/v1/admin/discounts')
      .query({ sortBy: 'invalid' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('creates, updates, activates, and deactivates discounts', async () => {
    const token = signAdmin();
    const productId = seedProduct();

    const created = await request(server())
      .post('/api/v1/admin/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: '  Product ten  ',
        type: DiscountType.PERCENT,
        target: DiscountTarget.PRODUCT,
        percentValue: 10,
        productId,
      })
      .expect(201);

    const createdBody = asDiscountBody(created.body);
    expect(createdBody.data).toMatchObject({
      name: 'Product ten',
      type: DiscountType.PERCENT,
      target: DiscountTarget.PRODUCT,
      isActive: true,
      percentValue: 10,
      maxQuantityPerCustomer: null,
    });
    expect(createdBody.data).not.toHaveProperty('actorId');

    const updated = await request(server())
      .patch(`/api/v1/admin/discounts/${createdBody.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ precedence: 99 })
      .expect(200);
    expect(asDiscountBody(updated.body).data).toMatchObject({ precedence: 99 });

    await request(server())
      .patch(`/api/v1/admin/discounts/${createdBody.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false })
      .expect(400);

    const deactivated = await request(server())
      .post(`/api/v1/admin/discounts/${createdBody.data.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(asDiscountBody(deactivated.body).data.isActive).toBe(false);

    const activated = await request(server())
      .post(`/api/v1/admin/discounts/${createdBody.data.id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(asDiscountBody(activated.body).data.isActive).toBe(true);
  });

  it('round-trips PRODUCT maxQuantityPerCustomer and rejects non-PRODUCT caps', async () => {
    const token = signAdmin();
    const productId = seedProduct();

    const created = await request(server())
      .post('/api/v1/admin/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Capped product',
        type: DiscountType.PERCENT,
        target: DiscountTarget.PRODUCT,
        percentValue: 10,
        productId,
        maxQuantityPerCustomer: 3,
      })
      .expect(201);

    const createdBody = asDiscountBody(created.body);
    expect(createdBody.data).toMatchObject({
      target: DiscountTarget.PRODUCT,
      maxQuantityPerCustomer: 3,
    });

    const cleared = await request(server())
      .patch(`/api/v1/admin/discounts/${createdBody.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ maxQuantityPerCustomer: null })
      .expect(200);
    expect(asDiscountBody(cleared.body).data.maxQuantityPerCustomer).toBe(null);

    const badCategory = await request(server())
      .post('/api/v1/admin/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Capped category',
        type: DiscountType.PERCENT,
        target: DiscountTarget.CATEGORY,
        percentValue: 10,
        categoryId: activeCategoryId,
        maxQuantityPerCustomer: 3,
      })
      .expect(400);
    expect(asApiErrorBody(badCategory.body).error.code).toBe(
      'DISCOUNT_INVALID_TARGET',
    );

    const badOrder = await request(server())
      .post('/api/v1/admin/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Capped order',
        type: DiscountType.PERCENT,
        target: DiscountTarget.ORDER,
        percentValue: 10,
        maxQuantityPerCustomer: 3,
      })
      .expect(400);
    expect(asApiErrorBody(badOrder.body).error.code).toBe(
      'DISCOUNT_INVALID_TARGET',
    );
  });

  it('rejects invalid discount combinations with displayable errors', async () => {
    const token = signAdmin();

    const badPercent = await request(server())
      .post('/api/v1/admin/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Bad percent',
        type: DiscountType.PERCENT,
        target: DiscountTarget.ORDER,
        percentValue: 101,
      })
      .expect(400);
    expect(asApiErrorBody(badPercent.body).error.code).toBe('BAD_REQUEST');

    const badTypeValue = await request(server())
      .post('/api/v1/admin/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Missing percent',
        type: DiscountType.PERCENT,
        target: DiscountTarget.ORDER,
      })
      .expect(400);
    expect(asApiErrorBody(badTypeValue.body).error.code).toBe(
      'DISCOUNT_INVALID_TYPE_VALUE',
    );

    const badWindow = await request(server())
      .post('/api/v1/admin/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Bad window',
        type: DiscountType.PERCENT,
        target: DiscountTarget.ORDER,
        percentValue: 10,
        startsAt: '2026-12-01T00:00:00.000Z',
        endsAt: '2026-11-01T00:00:00.000Z',
      })
      .expect(400);
    expect(asApiErrorBody(badWindow.body).error.code).toBe(
      'DISCOUNT_INVALID_WINDOW',
    );
  });

  it('returns DISCOUNT_NOT_FOUND for missing discount mutations', async () => {
    const token = signAdmin();
    const missingId = randomUUID();

    const patch = await request(server())
      .patch(`/api/v1/admin/discounts/${missingId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Nope' })
      .expect(404);
    expect(asApiErrorBody(patch.body).error.code).toBe('DISCOUNT_NOT_FOUND');
  });

  it('lists price history newest first with pagination and no-op price changes', async () => {
    const token = signAdmin();
    const productId = seedProduct(1000);

    const first = await request(server())
      .patch(`/api/v1/admin/pricing/products/${productId}/price`)
      .set('Authorization', `Bearer ${token}`)
      .send({ price: 1200 })
      .expect(200);
    expect(asPriceChangeBody(first.body).data).toMatchObject({
      price: 1200,
      historyWritten: true,
    });

    const noop = await request(server())
      .patch(`/api/v1/admin/pricing/products/${productId}/price`)
      .set('Authorization', `Bearer ${token}`)
      .send({ price: 1200 })
      .expect(200);
    expect(asPriceChangeBody(noop.body).data.historyWritten).toBe(false);

    await request(server())
      .patch(`/api/v1/admin/pricing/products/${productId}/price`)
      .set('Authorization', `Bearer ${token}`)
      .send({ price: 1500 })
      .expect(200);

    const page = await request(server())
      .get(`/api/v1/admin/pricing/products/${productId}/price-history`)
      .query({ page: 1, pageSize: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const pageBody = asPriceHistoryListBody(page.body);
    expect(pageBody.meta.total).toBe(2);
    expect(pageBody.data).toHaveLength(1);
    expect(pageBody.data[0]).toMatchObject({
      oldPrice: 1200,
      newPrice: 1500,
    });
  });

  it('returns PRODUCT_NOT_FOUND for unknown product pricing routes', async () => {
    const token = signAdmin();
    const missingId = randomUUID();

    const history = await request(server())
      .get(`/api/v1/admin/pricing/products/${missingId}/price-history`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    expect(asApiErrorBody(history.body).error.code).toBe('PRODUCT_NOT_FOUND');

    const price = await request(server())
      .patch(`/api/v1/admin/pricing/products/${missingId}/price`)
      .set('Authorization', `Bearer ${token}`)
      .send({ price: 1000 })
      .expect(404);
    expect(asApiErrorBody(price.body).error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('requires DISCOUNT_MANAGE for price mutations', async () => {
    admins.activeRole(AdminRole.ORDER_OPS);
    const token = signAccessToken(AuthSubjectType.ADMIN);
    const productId = seedProduct();

    await request(server())
      .patch(`/api/v1/admin/pricing/products/${productId}/price`)
      .set('Authorization', `Bearer ${token}`)
      .send({ price: 2000 })
      .expect(403);
  });
});

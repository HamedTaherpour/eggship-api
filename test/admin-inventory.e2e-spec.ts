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
import type {
  CategoryListQuery,
  CategoryRecord,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '../src/modules/categories/domain/category';
import { normalizeCategoryName } from '../src/modules/categories/domain/category-name';
import { CategoryRepository } from '../src/modules/categories/infrastructure/category.repository';
import {
  toInventoryBalance,
  type InventoryBalance,
} from '../src/modules/inventory/domain/inventory-balance';
import {
  hashAdjustPayload,
  hashReceivePayload,
  InventoryCommandIdempotencyStatus,
  type InventoryCommandOperation,
  type InventoryCommandIdempotencyRecord,
} from '../src/modules/inventory/domain/inventory-command-idempotency';
import {
  InventoryInvalidAdjustmentError,
  InventoryNotFoundError,
} from '../src/modules/inventory/domain/inventory-errors';
import type { InventoryLedgerEntry } from '../src/modules/inventory/domain/inventory-ledger';
import type {
  InventoryListQuery,
  InventoryListRecord,
  InventoryLedgerListQuery,
  InventoryReservationListQuery,
} from '../src/modules/inventory/domain/inventory-list';
import { toInventoryListRecord } from '../src/modules/inventory/domain/inventory-list';
import type { InventoryReservation } from '../src/modules/inventory/domain/inventory-reservation';
import {
  INVENTORY_INT4_MAX,
  assertAdjustmentDelta,
  assertInventoryUuid,
  assertPositiveQuantity,
} from '../src/modules/inventory/domain/inventory-quantity';
import type { AppendLedgerInput } from '../src/modules/inventory/infrastructure/inventory-ledger.repository';
import { InventoryBalanceRepository } from '../src/modules/inventory/infrastructure/inventory-balance.repository';
import { InventoryCommandIdempotencyRepository } from '../src/modules/inventory/infrastructure/inventory-command-idempotency.repository';
import { InventoryLedgerRepository } from '../src/modules/inventory/infrastructure/inventory-ledger.repository';
import { InventoryReservationRepository } from '../src/modules/inventory/infrastructure/inventory-reservation.repository';
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
  categories!: InMemoryCategoryRepository;
  private readonly rows = new Map<string, ProductRecord>();

  clear(): void {
    this.rows.clear();
  }

  seed(record: ProductRecord): void {
    this.rows.set(record.id, record);
  }

  findById(id: string): Promise<ProductRecord | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  list(
    query: ProductListQuery,
  ): Promise<{ items: ProductRecord[]; total: number }> {
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
    const total = items.length;
    const start = (query.page - 1) * query.pageSize;
    return Promise.resolve({
      items: items.slice(start, start + query.pageSize),
      total,
    });
  }

  create(input: CreateProductInput): Promise<ProductRecord> {
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

  update(id: string, input: UpdateProductInput): Promise<ProductRecord | null> {
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
      price:
        input.price !== undefined
          ? normalizeProductPrice(input.price)
          : existing.price,
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

class InMemoryInventoryBalanceRepository {
  products!: InMemoryProductRepository;
  private readonly rows = new Map<string, InventoryBalance>();

  clear(): void {
    this.rows.clear();
  }

  seed(balance: InventoryBalance): void {
    this.rows.set(balance.productId, balance);
  }

  ensureForProduct(productId: string): Promise<InventoryBalance> {
    const id = assertInventoryUuid(productId, 'productId');
    const existing = this.rows.get(id);
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }
    const now = new Date();
    const created = toInventoryBalance({
      productId: id,
      onHand: 0,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });
    this.rows.set(id, created);
    return Promise.resolve(created);
  }

  findByProductId(productId: string): Promise<InventoryBalance | null> {
    return Promise.resolve(
      this.rows.get(assertInventoryUuid(productId, 'productId')) ?? null,
    );
  }

  async listAdmin(
    query: InventoryListQuery,
  ): Promise<{ items: InventoryListRecord[]; total: number }> {
    const items: InventoryListRecord[] = [];
    for (const balance of this.rows.values()) {
      const product = await this.products.findById(balance.productId);
      if (product === null) {
        continue;
      }
      if (query.isActive !== undefined && product.isActive !== query.isActive) {
        continue;
      }
      if (query.search !== undefined) {
        const needle = query.search.toLowerCase();
        if (!product.name.toLowerCase().includes(needle)) {
          continue;
        }
      }
      items.push(
        toInventoryListRecord({
          productId: balance.productId,
          productName: product.name,
          isActive: product.isActive,
          onHand: balance.onHand,
          reserved: balance.reserved,
          updatedAt: balance.updatedAt,
        }),
      );
    }

    items.sort((left, right) => {
      const direction = query.sortOrder === 'asc' ? 1 : -1;
      switch (query.sortBy) {
        case 'productName':
          return direction * left.productName.localeCompare(right.productName);
        case 'onHand':
          return direction * (left.onHand - right.onHand);
        case 'reserved':
          return direction * (left.reserved - right.reserved);
        case 'available':
          return direction * (left.available - right.available);
        case 'updatedAt':
          return (
            direction * (left.updatedAt.getTime() - right.updatedAt.getTime())
          );
        default:
          return 0;
      }
    });

    const total = items.length;
    const start = (query.page - 1) * query.pageSize;
    return {
      items: items.slice(start, start + query.pageSize),
      total,
    };
  }

  lockBalances(productIds: readonly string[]): Promise<InventoryBalance[]> {
    return Promise.resolve(
      productIds
        .map((id) => this.rows.get(assertInventoryUuid(id, 'productId')))
        .filter((row): row is InventoryBalance => row !== undefined),
    );
  }

  incrementOnHand(
    productId: string,
    quantity: number,
  ): Promise<InventoryBalance> {
    const id = assertInventoryUuid(productId, 'productId');
    const qty = assertPositiveQuantity(quantity);
    const existing = this.rows.get(id);
    if (existing === undefined) {
      throw new InventoryNotFoundError('missing');
    }
    if (existing.onHand > INVENTORY_INT4_MAX - qty) {
      throw new InventoryInvalidAdjustmentError('overflow');
    }
    const updated = toInventoryBalance({
      ...existing,
      onHand: existing.onHand + qty,
      updatedAt: new Date(),
    });
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  adjustOnHand(productId: string, delta: number): Promise<InventoryBalance> {
    const id = assertInventoryUuid(productId, 'productId');
    const signed = assertAdjustmentDelta(delta);
    const existing = this.rows.get(id);
    if (existing === undefined) {
      throw new InventoryNotFoundError('missing');
    }
    const nextOnHand = existing.onHand + signed;
    if (
      nextOnHand < 0 ||
      nextOnHand < existing.reserved ||
      nextOnHand > INVENTORY_INT4_MAX
    ) {
      throw new InventoryInvalidAdjustmentError('invalid');
    }
    const updated = toInventoryBalance({
      ...existing,
      onHand: nextOnHand,
      updatedAt: new Date(),
    });
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }
}

class InMemoryInventoryLedgerRepository {
  readonly entries: InventoryLedgerEntry[] = [];

  clear(): void {
    this.entries.length = 0;
  }

  append(input: AppendLedgerInput): Promise<InventoryLedgerEntry> {
    const entry: InventoryLedgerEntry = {
      id: randomUUID(),
      productId: input.productId,
      type: input.type,
      quantity: input.quantity,
      onHandDelta: input.onHandDelta,
      reservedDelta: input.reservedDelta,
      onHandAfter: input.onHandAfter,
      reservedAfter: input.reservedAfter,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      reason: input.reason ?? null,
      actorType: input.actorType,
      actorId: input.actorId,
      correlationId: input.correlationId ?? null,
      createdAt: new Date(),
    };
    this.entries.push(entry);
    return Promise.resolve(entry);
  }

  findOrderEvent(): Promise<InventoryLedgerEntry | null> {
    return Promise.resolve(null);
  }

  listByProduct(productId: string): Promise<InventoryLedgerEntry[]> {
    return Promise.resolve(
      this.entries.filter((row) => row.productId === productId),
    );
  }

  listByProductPaginated(
    query: InventoryLedgerListQuery,
  ): Promise<{ items: InventoryLedgerEntry[]; total: number }> {
    let items = this.entries.filter((row) => row.productId === query.productId);
    if (query.type !== undefined) {
      items = items.filter((row) => row.type === query.type);
    }
    items = [...items].sort((left, right) => {
      const byTime = right.createdAt.getTime() - left.createdAt.getTime();
      if (byTime !== 0) {
        return byTime;
      }
      return right.id.localeCompare(left.id);
    });
    const total = items.length;
    const start = (query.page - 1) * query.pageSize;
    return Promise.resolve({
      items: items.slice(start, start + query.pageSize),
      total,
    });
  }
}

class InMemoryInventoryReservationRepository {
  private readonly rows: InventoryReservation[] = [];

  clear(): void {
    this.rows.length = 0;
  }

  seed(row: InventoryReservation): void {
    this.rows.push(row);
  }

  listByProduct(productId: string): Promise<InventoryReservation[]> {
    return Promise.resolve(
      this.rows.filter((row) => row.productId === productId),
    );
  }

  listByProductPaginated(
    query: InventoryReservationListQuery,
  ): Promise<{ items: InventoryReservation[]; total: number }> {
    let items = this.rows.filter((row) => row.productId === query.productId);
    if (query.status !== undefined) {
      items = items.filter((row) => row.status === query.status);
    }
    items = [...items].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );
    const total = items.length;
    const start = (query.page - 1) * query.pageSize;
    return Promise.resolve({
      items: items.slice(start, start + query.pageSize),
      total,
    });
  }
}

class InMemoryInventoryCommandIdempotencyRepository {
  private readonly rows = new Map<string, InventoryCommandIdempotencyRecord>();

  clear(): void {
    this.rows.clear();
  }

  findByKeyForUpdate(
    idempotencyKey: string,
  ): Promise<InventoryCommandIdempotencyRecord | null> {
    return Promise.resolve(
      this.rows.get(assertInventoryUuid(idempotencyKey, 'idempotencyKey')) ??
        null,
    );
  }

  insertPending(input: {
    idempotencyKey: string;
    operation: InventoryCommandOperation;
    productId: string;
    payloadHash: string;
  }): Promise<InventoryCommandIdempotencyRecord | null> {
    const key = assertInventoryUuid(input.idempotencyKey, 'idempotencyKey');
    if (this.rows.has(key)) {
      return Promise.resolve(null);
    }
    const created: InventoryCommandIdempotencyRecord = {
      id: randomUUID(),
      idempotencyKey: key,
      operation: input.operation,
      productId: assertInventoryUuid(input.productId, 'productId'),
      payloadHash: input.payloadHash,
      status: InventoryCommandIdempotencyStatus.PENDING,
      onHandAfter: null,
      reservedAfter: null,
      ledgerId: null,
      createdAt: new Date(),
    };
    this.rows.set(key, created);
    return Promise.resolve(created);
  }

  markCompleted(input: {
    idempotencyKey: string;
    onHandAfter: number;
    reservedAfter: number;
    ledgerId: string;
  }): Promise<InventoryCommandIdempotencyRecord> {
    const key = assertInventoryUuid(input.idempotencyKey, 'idempotencyKey');
    const existing = this.rows.get(key);
    if (existing === undefined) {
      throw new Error('missing idempotency row');
    }
    const completed: InventoryCommandIdempotencyRecord = {
      ...existing,
      status: InventoryCommandIdempotencyStatus.COMPLETED,
      onHandAfter: input.onHandAfter,
      reservedAfter: input.reservedAfter,
      ledgerId: assertInventoryUuid(input.ledgerId, 'ledgerId'),
    };
    this.rows.set(key, completed);
    return Promise.resolve(completed);
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

interface InventoryBalanceBody {
  data: {
    productId: string;
    onHand: number;
    reserved: number;
    available: number;
    updatedAt: string;
  };
}

function asApiErrorBody(body: unknown): ApiErrorBody {
  return body as ApiErrorBody;
}

function asInventoryBalanceBody(body: unknown): InventoryBalanceBody {
  return body as InventoryBalanceBody;
}

describe('Admin inventory APIs (e2e)', () => {
  let app: INestApplication;
  let categories: InMemoryCategoryRepository;
  let products: InMemoryProductRepository;
  let balances: InMemoryInventoryBalanceRepository;
  let ledger: InMemoryInventoryLedgerRepository;
  let reservations: InMemoryInventoryReservationRepository;
  let idempotency: InMemoryInventoryCommandIdempotencyRepository;
  let admins: ConfigurableAdminRoleResolver;
  let activeCategoryId: string;

  beforeAll(async () => {
    categories = new InMemoryCategoryRepository();
    products = new InMemoryProductRepository();
    products.categories = categories;
    balances = new InMemoryInventoryBalanceRepository();
    balances.products = products;
    ledger = new InMemoryInventoryLedgerRepository();
    reservations = new InMemoryInventoryReservationRepository();
    idempotency = new InMemoryInventoryCommandIdempotencyRepository();
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
      .overrideProvider(TransactionRunner)
      .useValue(new PassThroughTransactionRunner())
      .overrideProvider(InventoryBalanceRepository)
      .useValue(balances)
      .overrideProvider(InventoryLedgerRepository)
      .useValue(ledger)
      .overrideProvider(InventoryCommandIdempotencyRepository)
      .useValue(idempotency)
      .overrideProvider(InventoryReservationRepository)
      .useValue(reservations)
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
    balances.clear();
    ledger.clear();
    reservations.clear();
    idempotency.clear();
    admins.reset();

    const now = new Date();
    activeCategoryId = randomUUID();
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

  function seedProduct(onHand = 0, reserved = 0): string {
    const now = new Date();
    const productId = randomUUID();
    products.seed({
      id: productId,
      name: 'Warehouse eggs',
      price: 1000,
      categoryId: activeCategoryId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    balances.seed(
      toInventoryBalance({
        productId,
        onHand,
        reserved,
        createdAt: now,
        updatedAt: now,
      }),
    );
    return productId;
  }

  it('documents AdminInventory operations in OpenAPI', () => {
    const doc = createOpenApiDocument(app);
    expect(doc.paths['/api/v1/admin/inventory']?.get).toBeDefined();
    expect(
      doc.paths['/api/v1/admin/inventory/{productId}/reconciliation']?.get,
    ).toBeDefined();
    expect(
      doc.paths['/api/v1/admin/inventory/{productId}/ledger']?.get,
    ).toBeDefined();
    expect(
      doc.paths['/api/v1/admin/inventory/{productId}/reservations']?.get,
    ).toBeDefined();
    expect(
      doc.paths['/api/v1/admin/inventory/{productId}/receive']?.post,
    ).toBeDefined();
    expect(
      doc.paths['/api/v1/admin/inventory/{productId}/adjust']?.post,
    ).toBeDefined();
    expect(doc.paths['/api/v1/admin/inventory/{productId}']?.get).toBeDefined();
  });

  it('requires authentication and INVENTORY permissions on read routes', async () => {
    const productId = seedProduct();

    await request(server()).get('/api/v1/admin/inventory').expect(401);

    const userToken = signAccessToken(AuthSubjectType.USER);
    await request(server())
      .get('/api/v1/admin/inventory')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    admins.activeRole(AdminRole.ORDER_OPS);
    const orderOpsToken = signAccessToken(AuthSubjectType.ADMIN);
    await request(server())
      .post(`/api/v1/admin/inventory/${productId}/receive`)
      .set('Authorization', `Bearer ${orderOpsToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ quantity: 1 })
      .expect(403);
    await request(server())
      .get(`/api/v1/admin/inventory/${productId}/ledger`)
      .set('Authorization', `Bearer ${orderOpsToken}`)
      .expect(200);

    admins.activeRole(AdminRole.WAREHOUSE);
    const warehouseToken = signAccessToken(AuthSubjectType.ADMIN);
    await request(server())
      .get('/api/v1/admin/inventory')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .expect(200);

    admins.activeRole(AdminRole.SUPER_ADMIN);
    const superAdminToken = signAccessToken(AuthSubjectType.ADMIN);
    await request(server())
      .get(`/api/v1/admin/inventory/${productId}/reconciliation`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
  });

  it('receives stock and adjusts by signed delta', async () => {
    admins.activeRole(AdminRole.WAREHOUSE);
    const token = signAccessToken(AuthSubjectType.ADMIN);
    const productId = seedProduct(10, 2);
    const receiveKey = randomUUID();

    const received = await request(server())
      .post(`/api/v1/admin/inventory/${productId}/receive`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', receiveKey)
      .send({ quantity: 500 })
      .expect(200);

    const receivedBody = asInventoryBalanceBody(received.body);
    expect(receivedBody.data).toMatchObject({
      productId,
      onHand: 510,
      reserved: 2,
      available: 508,
    });
    expect(received.headers['x-request-id']).toBeDefined();

    const replay = await request(server())
      .post(`/api/v1/admin/inventory/${productId}/receive`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', receiveKey)
      .send({ quantity: 500 })
      .expect(200);
    expect(asInventoryBalanceBody(replay.body).data.onHand).toBe(510);
    expect(ledger.entries.filter((row) => row.type === 'RECEIVE')).toHaveLength(
      1,
    );

    const adjusted = await request(server())
      .post(`/api/v1/admin/inventory/${productId}/adjust`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ delta: -6, reason: 'شکستگی هنگام جابه‌جایی' })
      .expect(200);
    expect(asInventoryBalanceBody(adjusted.body).data).toMatchObject({
      onHand: 504,
      reserved: 2,
      available: 502,
    });
  });

  it('rejects invalid payloads and adjustment below reserved', async () => {
    admins.activeRole(AdminRole.WAREHOUSE);
    const token = signAccessToken(AuthSubjectType.ADMIN);
    const productId = seedProduct(10, 8);

    await request(server())
      .post(`/api/v1/admin/inventory/${productId}/receive`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ quantity: 0 })
      .expect(400);

    await request(server())
      .post(`/api/v1/admin/inventory/${productId}/adjust`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ delta: 0, reason: 'noop' })
      .expect(400);

    const missingReason = await request(server())
      .post(`/api/v1/admin/inventory/${productId}/adjust`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ delta: -1 })
      .expect(400);
    expect(asApiErrorBody(missingReason.body).error.code).toBe('BAD_REQUEST');

    const belowReserved = await request(server())
      .post(`/api/v1/admin/inventory/${productId}/adjust`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ delta: -4, reason: 'cycle count' })
      .expect(400);
    expect(asApiErrorBody(belowReserved.body).error.code).toBe(
      'INVENTORY_INVALID_ADJUSTMENT',
    );
    expect(asApiErrorBody(belowReserved.body).error.message).toBe(
      'این تغییر موجودی با مقدار رزروشده سازگار نیست.',
    );

    await request(server())
      .post(`/api/v1/admin/inventory/${productId}/receive`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 1, onHand: 999 })
      .expect(400);
  });

  it('conflicts when the same idempotency key is reused with a different payload', async () => {
    admins.activeRole(AdminRole.WAREHOUSE);
    const token = signAccessToken(AuthSubjectType.ADMIN);
    const productId = seedProduct();
    const key = randomUUID();

    await request(server())
      .post(`/api/v1/admin/inventory/${productId}/receive`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ quantity: 5 })
      .expect(200);

    const conflict = await request(server())
      .post(`/api/v1/admin/inventory/${productId}/receive`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ quantity: 6 })
      .expect(409);
    expect(asApiErrorBody(conflict.body).error.code).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
    expect(hashReceivePayload({ productId, quantity: 5 })).not.toBe(
      hashReceivePayload({ productId, quantity: 6 }),
    );
    expect(
      hashAdjustPayload({ productId, delta: -1, reason: 'x' }),
    ).toBeTruthy();
  });

  it('returns INVENTORY_NOT_FOUND for unknown inventory rows', async () => {
    admins.activeRole(AdminRole.WAREHOUSE);
    const token = signAccessToken(AuthSubjectType.ADMIN);
    const missingProductId = randomUUID();

    const missing = await request(server())
      .get(`/api/v1/admin/inventory/${missingProductId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    expect(asApiErrorBody(missing.body).error.code).toBe('INVENTORY_NOT_FOUND');
  });

  it('lists inventory with pagination, search, filter, sort, and rejects unknown query', async () => {
    admins.activeRole(AdminRole.WAREHOUSE);
    const token = signAccessToken(AuthSubjectType.ADMIN);
    const now = new Date();
    const activeId = randomUUID();
    const inactiveId = randomUUID();
    products.seed({
      id: activeId,
      name: 'Alpha warehouse eggs',
      price: 1000,
      categoryId: activeCategoryId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    products.seed({
      id: inactiveId,
      name: 'Beta warehouse eggs',
      price: 2000,
      categoryId: activeCategoryId,
      isActive: false,
      createdAt: now,
      updatedAt: now,
    });
    balances.seed(
      toInventoryBalance({
        productId: activeId,
        onHand: 10,
        reserved: 2,
        createdAt: now,
        updatedAt: now,
      }),
    );
    balances.seed(
      toInventoryBalance({
        productId: inactiveId,
        onHand: 50,
        reserved: 0,
        createdAt: now,
        updatedAt: now,
      }),
    );

    const page = await request(server())
      .get('/api/v1/admin/inventory')
      .query({
        page: 1,
        pageSize: 1,
        search: 'alpha',
        sortBy: 'onHand',
        sortOrder: 'desc',
        isActive: 'true',
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = page.body as {
      data: Array<{ available: number; onHand: number; reserved: number }>;
      meta: { total: number; page: number; pageSize: number };
      requestId?: string;
    };
    expect(body.meta).toMatchObject({ total: 1, page: 1, pageSize: 1 });
    expect(body.data[0]).toMatchObject({
      onHand: 10,
      reserved: 2,
      available: 8,
    });
    expect(page.headers['x-request-id']).toBeDefined();

    await request(server())
      .get('/api/v1/admin/inventory')
      .query({ unknown: 'x' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('returns paginated ledger and reservation diagnostics without customer fields', async () => {
    admins.activeRole(AdminRole.WAREHOUSE);
    const token = signAccessToken(AuthSubjectType.ADMIN);
    const productId = seedProduct(20, 5);
    const orderId = randomUUID();
    const now = new Date();
    reservations.seed({
      id: randomUUID(),
      orderId,
      productId,
      quantity: 5,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });
    ledger.entries.push({
      id: randomUUID(),
      productId,
      type: 'RECEIVE',
      quantity: 20,
      onHandDelta: 20,
      reservedDelta: 0,
      onHandAfter: 20,
      reservedAfter: 0,
      referenceType: 'RECEIVE',
      referenceId: randomUUID(),
      reason: null,
      actorType: 'SYSTEM',
      actorId: null,
      correlationId: null,
      createdAt: now,
    });

    const reservationPage = await request(server())
      .get(`/api/v1/admin/inventory/${productId}/reservations`)
      .query({ page: 1, pageSize: 10, status: 'ACTIVE' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const reservationBody = reservationPage.body as {
      data: Array<Record<string, unknown>>;
    };
    expect(reservationBody.data[0]).toMatchObject({ orderId, quantity: 5 });
    expect(reservationBody.data[0]).not.toHaveProperty('customerPhone');

    const ledgerPage = await request(server())
      .get(`/api/v1/admin/inventory/${productId}/ledger`)
      .query({ page: 1, pageSize: 10, type: 'RECEIVE' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((ledgerPage.body as { data: unknown[] }).data).toHaveLength(1);
    expect(ledgerPage.headers['cache-control']).toBe('no-store');
  });

  it('returns reconciliation diagnostics with HTTP 200 for consistent inventory', async () => {
    admins.activeRole(AdminRole.WAREHOUSE);
    const token = signAccessToken(AuthSubjectType.ADMIN);
    const productId = seedProduct(0, 0);

    const response = await request(server())
      .get(`/api/v1/admin/inventory/${productId}/reconciliation`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as {
      data: { status: string; current: { available: number } };
    };
    expect(body.data.status).toBe('CONSISTENT');
    expect(body.data.current.available).toBe(0);
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { postgresIntegrationImports } from '../support/postgres-testing-module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { CategoryRepository } from '../../../src/modules/categories/infrastructure/category.repository';
import type { ProductRecord } from '../../../src/modules/products/domain/product';
import { ProductRepository } from '../../../src/modules/products/infrastructure/product.repository';
import type { RegionRecord } from '../../../src/modules/regions/domain/region';
import type { UserRecord } from '../../../src/modules/users/domain/user';
import { RegionRepository } from '../../../src/modules/regions/infrastructure/region.repository';
import { hashOrderCreatePayload } from '../../../src/modules/orders/domain/order-create-idempotency';
import type { TrustedCreateOrderInput } from '../../../src/modules/orders/domain/order';
import { OrderStatus } from '../../../src/modules/orders/domain/order-status';
import { OrderRepository } from '../../../src/modules/orders/infrastructure/order.repository';
import { OrdersModule } from '../../../src/modules/orders/orders.module';
import { UserRepository } from '../../../src/modules/users/infrastructure/user.repository';
import { UsersModule } from '../../../src/modules/users/users.module';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

function uniquePhone(suffix: number): string {
  const national = `913${String(suffix).padStart(7, '0')}`.slice(0, 10);
  return `+98${national}`;
}

async function truncateOrderTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "OrderLine", "Order", "Product", "Category", "Region", "User" RESTART IDENTITY CASCADE',
  );
}

function trustedCreate(input: {
  user: UserRecord;
  region: RegionRecord;
  product: ProductRecord;
  quantity?: number;
}): TrustedCreateOrderInput {
  const quantity = input.quantity ?? 1;
  const gross = BigInt(input.product.price) * BigInt(quantity);
  const idempotencyKey = randomUUID();
  return {
    userId: input.user.id,
    customerPhone: input.user.phone,
    regionId: input.region.id,
    regionName: input.region.name,
    idempotencyKey,
    idempotencyPayloadHash: hashOrderCreatePayload({
      regionId: input.region.id,
      lines: [{ productId: input.product.id, quantity }],
    }),
    pricingEvaluatedAt: new Date('2026-08-22T12:00:00.000Z'),
    commercePolicyRevision: 1,
    grossSubtotal: gross,
    lineDiscountTotal: 0n,
    subtotalAfterLineDiscounts: gross,
    orderDiscountAmount: 0n,
    total: gross,
    appliedOrderDiscount: null,
    lines: [
      {
        productId: input.product.id,
        productName: input.product.name,
        unitPrice: input.product.price,
        quantity,
        discountedQuantity: 0,
        grossLineTotal: gross,
        lineDiscountAmount: 0n,
        finalLineTotal: gross,
        appliedLineDiscount: null,
      },
    ],
  };
}

describe('Order customer read queries (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let users: UserRepository;
  let regions: RegionRepository;
  let categories: CategoryRepository;
  let products: ProductRepository;
  let orders: OrderRepository;
  let phoneCounter = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [...postgresIntegrationImports([UsersModule, OrdersModule])],
      providers: [RegionRepository, CategoryRepository, ProductRepository],
    }).compile();

    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    users = moduleRef.get(UserRepository);
    regions = moduleRef.get(RegionRepository);
    categories = moduleRef.get(CategoryRepository);
    products = moduleRef.get(ProductRepository);
    orders = moduleRef.get(OrderRepository);
    await app.init();
  });

  beforeEach(async () => {
    await truncateOrderTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  function nextPhone(): string {
    phoneCounter += 1;
    return uniquePhone(phoneCounter + (Date.now() % 1_000_000));
  }

  async function seedProduct(
    name: string,
    price: number,
  ): Promise<ProductRecord> {
    const category = await categories.create({ name: 'Eggs' });
    return products.create({ name, price, categoryId: category.id });
  }

  async function seedOrder(
    user: UserRecord,
    region: RegionRecord,
    product: ProductRecord,
    createdAt: Date,
  ): Promise<string> {
    const created = await orders.createWithTrustedSnapshots(
      trustedCreate({ user, region, product }),
    );
    await prisma.order.update({
      where: { id: created.id },
      data: {
        createdAt,
        status: OrderStatus.CONFIRMED,
        confirmedAt: createdAt,
      },
    });
    return created.id;
  }

  it('lists only the owner orders with status and date filters', async () => {
    const owner = await users.create({ phone: nextPhone() });
    const other = await users.create({ phone: nextPhone() });
    const region = await regions.create({ name: 'Tehran' });
    const product = await seedProduct('Eggs A', 10_000);

    const inRangeId = await seedOrder(
      owner,
      region,
      product,
      new Date('2026-08-10T12:00:00.000Z'),
    );
    await seedOrder(
      owner,
      region,
      product,
      new Date('2026-07-01T12:00:00.000Z'),
    );
    await seedOrder(
      other,
      region,
      product,
      new Date('2026-08-10T12:00:00.000Z'),
    );

    const page = await orders.listOwned(owner.id, {
      page: 1,
      pageSize: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      status: OrderStatus.CONFIRMED,
      createdFrom: new Date('2026-08-01T00:00:00.000Z'),
      createdTo: new Date('2026-08-31T23:59:59.999Z'),
    });

    expect(page.total).toBe(1);
    expect(page.items.map((row) => row.id)).toEqual([inRangeId]);
  });

  it('paginates deterministically with stable id tie-break', async () => {
    const owner = await users.create({ phone: nextPhone() });
    const region = await regions.create({ name: 'Tehran' });
    const product = await seedProduct('Eggs B', 5_000);
    const sameInstant = new Date('2026-08-15T12:00:00.000Z');

    const first = await seedOrder(owner, region, product, sameInstant);
    const second = await seedOrder(owner, region, product, sameInstant);

    const page = await orders.listOwned(owner.id, {
      page: 1,
      pageSize: 1,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    const expectedFirst = [first, second].sort((left, right) =>
      left.localeCompare(right),
    )[0];
    expect(page.items[0]?.id).toBe(expectedFirst);
  });

  it('keeps historical line snapshots on owned detail without Product joins', async () => {
    const owner = await users.create({ phone: nextPhone() });
    const region = await regions.create({ name: 'Tehran' });
    const product = await seedProduct('Original Eggs', 12_000);

    const created = await orders.createWithTrustedSnapshots(
      trustedCreate({ user: owner, region, product }),
    );

    await products.update(product.id, {
      name: 'Renamed Eggs',
      isActive: false,
    });
    await prisma.product.update({
      where: { id: product.id },
      data: { price: 99_000 },
    });

    const detail = await orders.findOwnedById(created.id, owner.id);
    expect(detail?.lines[0]).toMatchObject({
      productName: 'Original Eggs',
      unitPrice: 12_000,
    });
    expect(await orders.findOwnedById(created.id, randomUUID())).toBeNull();
  });
});

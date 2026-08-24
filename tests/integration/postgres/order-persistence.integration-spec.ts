import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../../src/generated/prisma/client';
import { postgresIntegrationImports } from '../support/postgres-testing-module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { TransactionRunner } from '../../../src/infrastructure/database/transaction';
import { CategoryRepository } from '../../../src/modules/categories/infrastructure/category.repository';
import type { ProductRecord } from '../../../src/modules/products/domain/product';
import { ProductRepository } from '../../../src/modules/products/infrastructure/product.repository';
import type { RegionRecord } from '../../../src/modules/regions/domain/region';
import type { UserRecord } from '../../../src/modules/users/domain/user';
import { RegionRepository } from '../../../src/modules/regions/infrastructure/region.repository';
import { hashOrderCreatePayload } from '../../../src/modules/orders/domain/order-create-idempotency';
import { OrderInvalidInputError } from '../../../src/modules/orders/domain/order-errors';
import type { TrustedCreateOrderInput } from '../../../src/modules/orders/domain/order';
import { OrderRepository } from '../../../src/modules/orders/infrastructure/order.repository';
import { OrdersModule } from '../../../src/modules/orders/orders.module';
import { UserRepository } from '../../../src/modules/users/infrastructure/user.repository';
import { UsersModule } from '../../../src/modules/users/users.module';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

function uniquePhone(suffix: number): string {
  const national = `912${String(suffix).padStart(7, '0')}`.slice(0, 10);
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
  idempotencyKey?: string;
}): TrustedCreateOrderInput {
  const quantity = input.quantity ?? 1;
  const gross = BigInt(input.product.price) * BigInt(quantity);
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
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
        grossLineTotal: gross,
        lineDiscountAmount: 0n,
        finalLineTotal: gross,
        appliedLineDiscount: null,
      },
    ],
  };
}

describe('Order persistence (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let users: UserRepository;
  let regions: RegionRepository;
  let categories: CategoryRepository;
  let products: ProductRepository;
  let orders: OrderRepository;
  let transactions: TransactionRunner;
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
    transactions = moduleRef.get(TransactionRunner);
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
    return products.create({
      name,
      price,
      categoryId: category.id,
    });
  }

  async function seedOrderContext(): Promise<{
    user: UserRecord;
    region: RegionRecord;
    product: ProductRecord;
  }> {
    const user = await users.create({ phone: nextPhone() });
    const region = await regions.create({ name: 'Tehran North' });
    const product = await seedProduct('تخم مرغ ممتاز', 625_000);
    return { user, region, product };
  }

  it('creates an order with trusted gross/final snapshots', async () => {
    const { user, region, product } = await seedOrderContext();

    const created = await orders.createWithTrustedSnapshots(
      trustedCreate({ user, region, product, quantity: 2 }),
    );

    expect(created).toMatchObject({
      userId: user.id,
      customerPhone: user.phone,
      regionId: region.id,
      regionName: region.name,
      grossSubtotal: 1_250_000n,
      lineDiscountTotal: 0n,
      subtotalAfterLineDiscounts: 1_250_000n,
      orderDiscountAmount: 0n,
      total: 1_250_000n,
      status: 'PENDING_REVIEW',
    });
    expect(created.lines).toEqual([
      expect.objectContaining({
        productId: product.id,
        productName: 'تخم مرغ ممتاز',
        unitPrice: 625_000,
        quantity: 2,
        grossLineTotal: 1_250_000n,
        finalLineTotal: 1_250_000n,
      }),
    ]);
  });

  it('keeps product name and price snapshots when Product changes later', async () => {
    const { user, region, product } = await seedOrderContext();

    const created = await orders.createWithTrustedSnapshots(
      trustedCreate({ user, region, product }),
    );

    await products.update(product.id, {
      name: 'تخم مرغ ویژه',
      isActive: false,
    });
    await prisma.product.update({
      where: { id: product.id },
      data: { price: 700_000 },
    });

    const reloaded = await orders.findById(created.id);
    expect(reloaded?.lines[0]).toMatchObject({
      productName: 'تخم مرغ ممتاز',
      unitPrice: 625_000,
      grossLineTotal: 625_000n,
    });
  });

  it('keeps customer phone and region snapshots when User and Region change later', async () => {
    const { user, region, product } = await seedOrderContext();

    const created = await orders.createWithTrustedSnapshots(
      trustedCreate({ user, region, product }),
    );

    await regions.update(region.id, {
      name: 'Renamed Region',
      isActive: false,
    });

    const reloaded = await orders.findById(created.id);
    expect(reloaded).toMatchObject({
      customerPhone: user.phone,
      regionName: 'Tehran North',
    });
    expect(created.id).toBe(reloaded?.id);
  });

  it('findOwnedById returns null for another user without existence leakage', async () => {
    const { user, region, product } = await seedOrderContext();
    const other = await users.create({ phone: nextPhone() });

    const created = await orders.createWithTrustedSnapshots(
      trustedCreate({ user, region, product }),
    );

    expect(await orders.findOwnedById(created.id, user.id)).not.toBeNull();
    expect(await orders.findOwnedById(created.id, other.id)).toBeNull();
  });

  it('enforces UNIQUE(orderId, productId) and positive quantity CHECK', async () => {
    const { user, region, product } = await seedOrderContext();
    const order = await orders.createWithTrustedSnapshots(
      trustedCreate({ user, region, product }),
    );

    await expect(
      prisma.orderLine.create({
        data: {
          id: randomUUID(),
          orderId: order.id,
          productId: product.id,
          productName: 'Duplicate',
          unitPrice: 1000,
          quantity: 1,
          grossLineTotal: 1000n,
          lineDiscountAmount: 0n,
          finalLineTotal: 1000n,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.orderLine.create({
        data: {
          id: randomUUID(),
          orderId: order.id,
          productId: randomUUID(),
          productName: 'Bad qty',
          unitPrice: 1000,
          quantity: 0,
          grossLineTotal: 0n,
          lineDiscountAmount: 0n,
          finalLineTotal: 0n,
        },
      }),
    ).rejects.toThrow();
  });

  it('blocks User hard delete while Orders exist (RESTRICT)', async () => {
    const { user, region, product } = await seedOrderContext();
    await orders.createWithTrustedSnapshots(
      trustedCreate({ user, region, product }),
    );

    await expect(
      prisma.user.delete({ where: { id: user.id } }),
    ).rejects.toThrow();
  });

  it('preserves the database error for duplicate repository writes', async () => {
    const { user, region, product } = await seedOrderContext();
    const idempotencyKey = randomUUID();

    await orders.createWithTrustedSnapshots(
      trustedCreate({ user, region, product, idempotencyKey }),
    );

    await expect(
      orders.createWithTrustedSnapshots(
        trustedCreate({ user, region, product, idempotencyKey }),
      ),
    ).rejects.toMatchObject({
      name: Prisma.PrismaClientKnownRequestError.name,
      code: 'P2002',
    });
  });

  it('rolls back order creation when a line violates constraints', async () => {
    const { user, region, product } = await seedOrderContext();
    const payload = trustedCreate({ user, region, product });
    payload.lines[0]!.productId = randomUUID();

    await expect(
      transactions.run(async (tx) =>
        orders.createWithTrustedSnapshots(payload, tx),
      ),
    ).rejects.toThrow();

    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.orderLine.count()).toBe(0);
  });

  it('rejects empty line lists at the repository boundary', async () => {
    const { user, region, product } = await seedOrderContext();
    const payload = trustedCreate({ user, region, product });
    payload.lines = [];

    await expect(
      orders.createWithTrustedSnapshots(payload),
    ).rejects.toBeInstanceOf(OrderInvalidInputError);
  });
});

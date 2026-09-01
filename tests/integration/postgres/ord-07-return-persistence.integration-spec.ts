import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../../src/generated/prisma/client';
import { postgresIntegrationImports } from '../support/postgres-testing-module';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { TransactionRunner } from '../../../src/infrastructure/database/transaction';
import { CategoryRepository } from '../../../src/modules/categories/infrastructure/category.repository';
import { ProductRepository } from '../../../src/modules/products/infrastructure/product.repository';
import { RegionRepository } from '../../../src/modules/regions/infrastructure/region.repository';
import { UserRepository } from '../../../src/modules/users/infrastructure/user.repository';
import { OrdersModule } from '../../../src/modules/orders/orders.module';
import { UsersModule } from '../../../src/modules/users/users.module';
import { OrderRepository } from '../../../src/modules/orders/infrastructure/order.repository';
import { OrderReturnRepository } from '../../../src/modules/orders/infrastructure/order-return.repository';
import { hashOrderCreatePayload } from '../../../src/modules/orders/domain/order-create-idempotency';
import type {
  TrustedCreateOrderInput,
  OrderRecord,
  OrderLineRecord,
} from '../../../src/modules/orders/domain/order';
import type { OrderReturnRecord } from '../../../src/modules/orders/domain/order-return';

async function truncateTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "OrderReturnLine", "OrderReturn", "OrderLine", "Order", "Admin", "Product", "Category", "Region", "User" RESTART IDENTITY CASCADE',
  );
}

describe('ORD-07 return persistence (PostgreSQL integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let users: UserRepository;
  let regions: RegionRepository;
  let categories: CategoryRepository;
  let products: ProductRepository;
  let orders: OrderRepository;
  let returns: OrderReturnRepository;
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
    returns = moduleRef.get(OrderReturnRepository);
    transactions = moduleRef.get(TransactionRunner);
    await app.init();
  });

  beforeEach(() => truncateTables(prisma));
  afterAll(() => app.close());

  async function context(): Promise<{
    admin: { id: string };
    order: OrderRecord;
    line: OrderLineRecord;
  }> {
    phoneCounter += 1;
    const user = await users.create({
      phone: `+98912${String(phoneCounter).padStart(7, '0')}`,
    });
    const region = await regions.create({ name: 'Tehran North' });
    const category = await categories.create({ name: 'Eggs' });
    const product = await products.create({
      name: 'Eggs',
      price: 1000,
      categoryId: category.id,
    });
    const admin = await prisma.admin.create({
      data: {
        email: `return-${phoneCounter}@example.com`,
        passwordHash: 'not-a-login-secret',
        role: 'SUPER_ADMIN',
      },
    });
    const quantity = 10;
    const total = BigInt(quantity * product.price);
    const input: TrustedCreateOrderInput = {
      userId: user.id,
      customerPhone: user.phone,
      regionId: region.id,
      regionName: region.name,
      idempotencyKey: randomUUID(),
      idempotencyPayloadHash: hashOrderCreatePayload({
        regionId: region.id,
        lines: [{ productId: product.id, quantity }],
      }),
      pricingEvaluatedAt: new Date('2026-09-01T00:00:00.000Z'),
      commercePolicyRevision: 1,
      grossSubtotal: total,
      lineDiscountTotal: 0n,
      subtotalAfterLineDiscounts: total,
      orderDiscountAmount: 0n,
      total,
      appliedOrderDiscount: null,
      lines: [
        {
          productId: product.id,
          productName: product.name,
          unitPrice: product.price,
          quantity,
          discountedQuantity: 0,
          grossLineTotal: total,
          lineDiscountAmount: 0n,
          finalLineTotal: total,
          appliedLineDiscount: null,
        },
      ],
    };
    const order = await orders.createWithTrustedSnapshots(input);
    return { admin, order, line: order.lines[0]! };
  }

  async function createReturn(input: {
    orderId: string;
    adminId: string;
    lineId: string;
    key?: string;
    sellableQuantity?: number;
    damagedQuantity?: number;
  }): Promise<OrderReturnRecord> {
    return transactions.run(async (tx) =>
      returns.createWithLines(
        {
          orderId: input.orderId,
          recordedByAdminId: input.adminId,
          reason: 'inspection complete',
          idempotencyKey: input.key ?? randomUUID(),
          idempotencyPayloadHash: 'a'.repeat(64),
          lines: [
            {
              orderLineId: input.lineId,
              sellableQuantity: input.sellableQuantity ?? 1,
              damagedQuantity: input.damagedQuantity ?? 0,
            },
          ],
        },
        tx,
      ),
    );
  }

  it('supports multiple return events for the same order line and deterministic reads', async () => {
    const { admin, order, line } = await context();
    const first = await createReturn({
      orderId: order.id,
      adminId: admin.id,
      lineId: line.id,
      sellableQuantity: 3,
    });
    const second = await createReturn({
      orderId: order.id,
      adminId: admin.id,
      lineId: line.id,
      sellableQuantity: 0,
      damagedQuantity: 4,
    });
    expect(
      (await returns.listByOrderId(order.id)).map((item) => item.id),
    ).toEqual([first.id, second.id]);
    expect(
      await transactions.run((tx) =>
        returns.sumReturnedQuantityByOrderLine(line.id, tx),
      ),
    ).toBe(7);
  });

  it.each([
    ['negative sellable', { sellableQuantity: -1, damagedQuantity: 1 }],
    ['negative damaged', { sellableQuantity: 1, damagedQuantity: -1 }],
    ['zero total', { sellableQuantity: 0, damagedQuantity: 0 }],
  ])('enforces quantity CHECK: %s', async (_name, quantities) => {
    const { admin, order, line } = await context();
    const returnId = randomUUID();
    await prisma.orderReturn.create({
      data: {
        id: returnId,
        orderId: order.id,
        recordedByAdminId: admin.id,
        reason: 'inspection complete',
        idempotencyKey: randomUUID(),
        idempotencyPayloadHash: 'b'.repeat(64),
      },
    });
    await expect(
      prisma.orderReturnLine.create({
        data: {
          id: randomUUID(),
          returnId,
          orderLineId: line.id,
          ...quantities,
        },
      }),
    ).rejects.toThrow();
  });

  it('persists payload proof and enforces idempotency-key uniqueness', async () => {
    const { admin, order, line } = await context();
    const key = randomUUID();
    await createReturn({
      orderId: order.id,
      adminId: admin.id,
      lineId: line.id,
      key,
    });
    expect(
      (await returns.findByIdempotencyKey(key))?.idempotencyPayloadHash,
    ).toBe('a'.repeat(64));
    await expect(
      createReturn({
        orderId: order.id,
        adminId: admin.id,
        lineId: line.id,
        key,
      }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('keeps returnedAt nullable and independent from return creation', async () => {
    const { admin, order, line } = await context();
    await createReturn({
      orderId: order.id,
      adminId: admin.id,
      lineId: line.id,
    });
    expect((await orders.findById(order.id))?.returnedAt).toBeNull();
  });

  it('restricts deletion of referenced order, line, and admin history', async () => {
    const { admin, order, line } = await context();
    await createReturn({
      orderId: order.id,
      adminId: admin.id,
      lineId: line.id,
    });
    await expect(
      prisma.admin.delete({ where: { id: admin.id } }),
    ).rejects.toThrow();
    await expect(
      prisma.orderLine.delete({ where: { id: line.id } }),
    ).rejects.toThrow();
    await expect(
      prisma.order.delete({ where: { id: order.id } }),
    ).rejects.toThrow();
  });
});

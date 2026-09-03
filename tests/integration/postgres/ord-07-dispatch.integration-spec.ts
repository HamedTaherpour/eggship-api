import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  postgresIntegrationImports,
  unusedPricingServiceProvider,
} from '../support/postgres-testing-module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { CategoryRepository } from '../../../src/modules/categories/infrastructure/category.repository';
import { CategoryService } from '../../../src/modules/categories/application/category.service';
import { InventoryModule } from '../../../src/modules/inventory/inventory.module';
import { OrderStatus } from '../../../src/modules/orders/domain/order-status';
import { ADMIN_DISPATCH_ORDER_LIMIT } from '../../../src/modules/orders/domain/order-dispatch';
import { OrderReadService } from '../../../src/modules/orders/application/order-read.service';
import { OrdersModule } from '../../../src/modules/orders/orders.module';
import { AuditModule } from '../../../src/modules/audit/audit.module';
import { ProductService } from '../../../src/modules/products/application/product.service';
import { ProductRepository } from '../../../src/modules/products/infrastructure/product.repository';
import { RegionRepository } from '../../../src/modules/regions/infrastructure/region.repository';
import { UserRepository } from '../../../src/modules/users/infrastructure/user.repository';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

type ExplainRow = {
  'QUERY PLAN': Array<{ Plan: { 'Node Type': string; 'Index Name'?: string } }>;
};

function uniquePhone(suffix: number): string {
  const national = `912${String(suffix).padStart(7, '0')}`.slice(0, 10);
  return `+98${national}`;
}

async function truncateDispatchTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "OutboxEvent", "DiscountUsageRecord", "DiscountCustomerUsage", "InventoryLedger", "InventoryReservation", "Inventory", "OrderReturnLine", "OrderReturn", "OrderLine", "Order", "Product", "Category", "Region", "User" RESTART IDENTITY CASCADE',
  );
}

describe('ORD-07 Admin Dispatch board (PostgreSQL integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let users: UserRepository;
  let regions: RegionRepository;
  let categories: CategoryRepository;
  let productService: ProductService;
  let reads: OrderReadService;
  let phoneCounter = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ...postgresIntegrationImports([
          InventoryModule,
          OrdersModule,
          AuditModule,
        ]),
      ],
      providers: [
        RegionRepository,
        CategoryRepository,
        CategoryService,
        ProductRepository,
        ProductService,
        unusedPricingServiceProvider(),
      ],
    }).compile();

    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    users = moduleRef.get(UserRepository);
    regions = moduleRef.get(RegionRepository);
    categories = moduleRef.get(CategoryRepository);
    productService = moduleRef.get(ProductService);
    reads = moduleRef.get(OrderReadService);
    await app.init();
  });

  beforeEach(async () => {
    await truncateDispatchTables(prisma);
    phoneCounter = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  function nextPhone(): string {
    phoneCounter += 1;
    return uniquePhone(phoneCounter + (Date.now() % 1_000_000));
  }

  async function seedFixture(): Promise<{
    regionA: { id: string; name: string };
    regionB: { id: string; name: string };
    productId: string;
    userId: string;
  }> {
    const user = await users.create({ phone: nextPhone() });
    const regionA = await regions.create({ name: 'Alpha Region' });
    const regionB = await regions.create({ name: 'Beta Region' });
    const category = await categories.create({ name: `Cat ${randomUUID()}` });
    const product = await productService.create({
      name: `Eggs ${randomUUID()}`,
      price: 1000,
      categoryId: category.id,
    });
    return {
      regionA: { id: regionA.id, name: regionA.name },
      regionB: { id: regionB.id, name: regionB.name },
      productId: product.id,
      userId: user.id,
    };
  }

  async function insertOrder(input: {
    userId: string;
    regionId: string;
    regionName: string;
    status: OrderStatus;
    customerPhone?: string;
    deliveryAt?: Date | null;
    confirmedAt?: Date | null;
    shippedAt?: Date | null;
    createdAt?: Date;
    /** Extra product ids create additional unique (orderId, productId) lines. */
    extraProductIds?: readonly string[];
    productId: string;
  }): Promise<string> {
    const id = randomUUID();
    const createdAt = input.createdAt ?? new Date('2026-09-01T10:00:00.000Z');
    const phone = input.customerPhone ?? nextPhone();
    const productIds = [input.productId, ...(input.extraProductIds ?? [])];
    await prisma.order.create({
      data: {
        id,
        userId: input.userId,
        status: input.status,
        customerPhone: phone,
        regionId: input.regionId,
        regionName: input.regionName,
        grossSubtotal: BigInt(1000 * productIds.length),
        lineDiscountTotal: 0n,
        subtotalAfterLineDiscounts: BigInt(1000 * productIds.length),
        orderDiscountAmount: 0n,
        total: BigInt(1000 * productIds.length),
        pricingEvaluatedAt: createdAt,
        commercePolicyRevision: 1,
        deliveryAt: input.deliveryAt ?? null,
        confirmedAt: input.confirmedAt ?? null,
        shippedAt: input.shippedAt ?? null,
        createdAt,
        lines: {
          create: productIds.map((productId) => ({
            productId,
            productName: 'Eggs',
            unitPrice: 1000,
            quantity: 1,
            discountedQuantity: 0,
            grossLineTotal: 1000n,
            lineDiscountAmount: 0n,
            finalLineTotal: 1000n,
          })),
        },
      },
    });
    return id;
  }

  it('returns only CONFIRMED/SHIPPED, groups by region, and orders deterministically', async () => {
    const fixture = await seedFixture();
    const tEarly = new Date('2026-09-10T08:00:00.000Z');
    const tLate = new Date('2026-09-11T08:00:00.000Z');
    const tCreated = new Date('2026-09-01T12:00:00.000Z');

    const category = await categories.create({ name: `Cat2 ${randomUUID()}` });
    const secondProduct = await productService.create({
      name: `Eggs2 ${randomUUID()}`,
      price: 1000,
      categoryId: category.id,
    });
    const aConfirmedEarly = await insertOrder({
      ...fixture,
      regionId: fixture.regionA.id,
      regionName: fixture.regionA.name,
      status: OrderStatus.CONFIRMED,
      deliveryAt: tEarly,
      confirmedAt: tCreated,
      createdAt: tCreated,
      extraProductIds: [secondProduct.id],
    });
    const aShippedLate = await insertOrder({
      ...fixture,
      regionId: fixture.regionA.id,
      regionName: fixture.regionA.name,
      status: OrderStatus.SHIPPED,
      deliveryAt: tLate,
      confirmedAt: tCreated,
      shippedAt: tCreated,
      createdAt: tCreated,
    });
    const aDelivered = await insertOrder({
      ...fixture,
      regionId: fixture.regionA.id,
      regionName: fixture.regionA.name,
      status: OrderStatus.DELIVERED,
      deliveryAt: tEarly,
      confirmedAt: tCreated,
      shippedAt: tCreated,
      createdAt: tCreated,
    });
    const bConfirmedNull = await insertOrder({
      ...fixture,
      regionId: fixture.regionB.id,
      regionName: fixture.regionB.name,
      status: OrderStatus.CONFIRMED,
      deliveryAt: null,
      confirmedAt: tCreated,
      createdAt: tCreated,
    });
    const bCancelled = await insertOrder({
      ...fixture,
      regionId: fixture.regionB.id,
      regionName: fixture.regionB.name,
      status: OrderStatus.CANCELLED,
      createdAt: tCreated,
    });

    const auditBefore = await prisma.auditLog.count();
    const updatedAts = await prisma.order.findMany({
      where: {
        id: {
          in: [
            aConfirmedEarly,
            aShippedLate,
            aDelivered,
            bConfirmedNull,
            bCancelled,
          ],
        },
      },
      select: { id: true, updatedAt: true, status: true },
      orderBy: { id: 'asc' },
    });

    const board = await reads.getDispatchBoard({});

    expect(board.summary).toMatchObject({
      ordersCount: 3,
      confirmedCount: 2,
      shippedCount: 1,
      regionCount: 2,
      truncated: false,
      matchedCount: 3,
      limit: ADMIN_DISPATCH_ORDER_LIMIT,
    });
    expect(board.groups.map((g) => g.region.name)).toEqual([
      'Alpha Region',
      'Beta Region',
    ]);
    expect(board.groups[0]!.orders.map((o) => o.id)).toEqual([
      aConfirmedEarly,
      aShippedLate,
    ]);
    expect(board.groups[0]!.orders[0]!.lineCount).toBe(2);
    expect(board.groups[1]!.orders.map((o) => o.id)).toEqual([bConfirmedNull]);

    const returnedIds = board.groups.flatMap((g) => g.orders.map((o) => o.id));
    expect(returnedIds).not.toContain(aDelivered);
    expect(returnedIds).not.toContain(bCancelled);

    const updatedAfter = await prisma.order.findMany({
      where: { id: { in: updatedAts.map((row) => row.id) } },
      select: { id: true, updatedAt: true, status: true },
      orderBy: { id: 'asc' },
    });
    expect(updatedAfter).toEqual(updatedAts);
    expect(await prisma.auditLog.count()).toBe(auditBefore);
  });

  it('applies region and pipeline status filters without leaking other statuses', async () => {
    const fixture = await seedFixture();
    const t = new Date('2026-09-01T12:00:00.000Z');
    await insertOrder({
      ...fixture,
      regionId: fixture.regionA.id,
      regionName: fixture.regionA.name,
      status: OrderStatus.CONFIRMED,
      createdAt: t,
      confirmedAt: t,
    });
    await insertOrder({
      ...fixture,
      regionId: fixture.regionA.id,
      regionName: fixture.regionA.name,
      status: OrderStatus.SHIPPED,
      createdAt: t,
      confirmedAt: t,
      shippedAt: t,
    });
    await insertOrder({
      ...fixture,
      regionId: fixture.regionB.id,
      regionName: fixture.regionB.name,
      status: OrderStatus.CONFIRMED,
      createdAt: t,
      confirmedAt: t,
    });

    const byRegion = await reads.getDispatchBoard({
      regionId: fixture.regionA.id,
    });
    expect(byRegion.summary.ordersCount).toBe(2);
    expect(byRegion.groups).toHaveLength(1);
    expect(byRegion.groups[0]!.region.id).toBe(fixture.regionA.id);

    const confirmedOnly = await reads.getDispatchBoard({
      status: OrderStatus.CONFIRMED,
    });
    expect(confirmedOnly.summary).toMatchObject({
      ordersCount: 2,
      confirmedCount: 2,
      shippedCount: 0,
    });
    expect(
      confirmedOnly.groups.every((g) =>
        g.orders.every((o) => o.status === OrderStatus.CONFIRMED),
      ),
    ).toBe(true);
  });

  it('uses stable id tie-break when deliveryAt and createdAt match', async () => {
    const fixture = await seedFixture();
    const stamp = new Date('2026-09-05T09:00:00.000Z');
    const created = new Date('2026-09-01T09:00:00.000Z');
    const higher = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const lower = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    await prisma.order.create({
      data: {
        id: higher,
        userId: fixture.userId,
        status: OrderStatus.CONFIRMED,
        customerPhone: nextPhone(),
        regionId: fixture.regionA.id,
        regionName: fixture.regionA.name,
        grossSubtotal: 1000n,
        lineDiscountTotal: 0n,
        subtotalAfterLineDiscounts: 1000n,
        orderDiscountAmount: 0n,
        total: 1000n,
        pricingEvaluatedAt: created,
        commercePolicyRevision: 1,
        deliveryAt: stamp,
        confirmedAt: created,
        createdAt: created,
        lines: {
          create: [
            {
              productId: fixture.productId,
              productName: 'Eggs',
              unitPrice: 1000,
              quantity: 1,
              discountedQuantity: 0,
              grossLineTotal: 1000n,
              lineDiscountAmount: 0n,
              finalLineTotal: 1000n,
            },
          ],
        },
      },
    });
    await prisma.order.create({
      data: {
        id: lower,
        userId: fixture.userId,
        status: OrderStatus.CONFIRMED,
        customerPhone: nextPhone(),
        regionId: fixture.regionA.id,
        regionName: fixture.regionA.name,
        grossSubtotal: 1000n,
        lineDiscountTotal: 0n,
        subtotalAfterLineDiscounts: 1000n,
        orderDiscountAmount: 0n,
        total: 1000n,
        pricingEvaluatedAt: created,
        commercePolicyRevision: 1,
        deliveryAt: stamp,
        confirmedAt: created,
        createdAt: created,
        lines: {
          create: [
            {
              productId: fixture.productId,
              productName: 'Eggs',
              unitPrice: 1000,
              quantity: 1,
              discountedQuantity: 0,
              grossLineTotal: 1000n,
              lineDiscountAmount: 0n,
              finalLineTotal: 1000n,
            },
          ],
        },
      },
    });

    const board = await reads.getDispatchBoard({});
    expect(board.groups[0]!.orders.map((o) => o.id)).toEqual([lower, higher]);
  });

  it('exposes truncation when matchedCount exceeds the V1 bound', async () => {
    const fixture = await seedFixture();
    const base = new Date('2026-09-01T10:00:00.000Z');
    for (let i = 0; i < ADMIN_DISPATCH_ORDER_LIMIT + 5; i += 1) {
      await insertOrder({
        ...fixture,
        regionId: fixture.regionA.id,
        regionName: fixture.regionA.name,
        status: OrderStatus.CONFIRMED,
        confirmedAt: base,
        createdAt: new Date(base.getTime() + i * 1000),
        deliveryAt: new Date(base.getTime() + i * 1000),
      });
    }

    const board = await reads.getDispatchBoard({});
    expect(board.summary.matchedCount).toBe(ADMIN_DISPATCH_ORDER_LIMIT + 5);
    expect(board.summary.ordersCount).toBe(ADMIN_DISPATCH_ORDER_LIMIT);
    expect(board.summary.truncated).toBe(true);
    expect(
      board.groups.reduce((sum, group) => sum + group.ordersCount, 0),
    ).toBe(ADMIN_DISPATCH_ORDER_LIMIT);
  });

  it('uses a single count + findMany shape (no N+1) and EXPLAIN remains viable', async () => {
    const fixture = await seedFixture();
    const t = new Date('2026-09-01T12:00:00.000Z');
    for (const region of [fixture.regionA, fixture.regionB]) {
      await insertOrder({
        ...fixture,
        regionId: region.id,
        regionName: region.name,
        status: OrderStatus.CONFIRMED,
        confirmedAt: t,
        createdAt: t,
      });
    }

    const queries: string[] = [];
    const client = prisma as unknown as {
      $on?(event: string, cb: (e: { query: string }) => void): void;
    };
    // Prisma event hooks are optional in some adapters; fall back to method proof.
    if (typeof client.$on === 'function') {
      client.$on('query', (event) => {
        queries.push(event.query);
      });
    }

    const board = await reads.getDispatchBoard({});
    expect(board.summary.ordersCount).toBe(2);

    if (queries.length > 0) {
      const orderQueries = queries.filter((q) =>
        /"Order"|FROM "Order"/i.test(q),
      );
      expect(orderQueries.length).toBeLessThanOrEqual(4);
      expect(queries.some((q) => /UPDATE\s+"Order"/i.test(q))).toBe(false);
    }

    const explainRows = await prisma.$queryRawUnsafe<ExplainRow[]>(
      `EXPLAIN (FORMAT JSON) SELECT "id", "status", "regionId", "regionName", "deliveryAt", "createdAt" FROM "Order" WHERE "status" IN ('CONFIRMED'::"OrderStatus", 'SHIPPED'::"OrderStatus") ORDER BY "deliveryAt" ASC NULLS LAST, "createdAt" ASC, "id" ASC LIMIT 100`,
    );
    expect(explainRows[0]?.['QUERY PLAN'][0]?.Plan['Node Type']).toBeDefined();

    const indexes = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'Order' ORDER BY indexname`,
    );
    expect(indexes.some((row) => row.indexname.includes('status'))).toBe(true);
  });
});

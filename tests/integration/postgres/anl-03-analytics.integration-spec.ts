import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AnalyticsModule } from '../../../src/modules/analytics/analytics.module';
import { AnalyticsService } from '../../../src/modules/analytics/application/analytics.service';
import { AnalyticsTopProductsBasis } from '../../../src/modules/analytics/api/dto/analytics-query.dto';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { postgresIntegrationImports } from '../support/postgres-testing-module';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const DAY = '2026-09-01';

describe('ANL-03 sales, top products, and today pulse (PostgreSQL integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let analytics: AnalyticsService;
  let userId: string;
  let regionId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: postgresIntegrationImports([AnalyticsModule]),
    }).compile();
    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    analytics = moduleRef.get(AnalyticsService);
    await app.init();
  });

  beforeEach(async () => {
    assertDestructiveOperationsAllowed();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "OrderReturnLine", "OrderReturn", "OrderLine", "Order", "InventoryLedger", "Inventory", "Product", "Category", "Region", "User", "Admin" RESTART IDENTITY CASCADE',
    );
    userId = randomUUID();
    regionId = randomUUID();
    await prisma.user.create({
      data: { id: userId, phone: `+98912${String(Date.now()).slice(-7)}` },
    });
    await prisma.region.create({
      data: { id: regionId, name: `ANL-03-${randomUUID()}` },
    });
  });

  afterAll(async () => app.close());

  async function product(name: string): Promise<string> {
    const category = await prisma.category.create({
      data: { name: `ANL-03-${randomUUID()}` },
    });
    const row = await prisma.product.create({
      data: { name, price: 1000, categoryId: category.id },
    });
    await prisma.inventory.create({
      data: { productId: row.id, onHand: 100, reserved: 0 },
    });
    return row.id;
  }

  async function order(input: {
    createdAt: Date;
    deliveredAt?: Date;
    shippedAt?: Date;
    confirmedAt?: Date;
    cancelledAt?: Date;
    status?:
      'PENDING_REVIEW' | 'DELIVERED' | 'CANCELLED' | 'RETURNED' | 'SHIPPED';
    total: bigint;
    grossSubtotal: bigint;
    lineDiscountTotal?: bigint;
    orderDiscountAmount?: bigint;
    lines: Array<{
      productId: string;
      productName: string;
      quantity: number;
      gross: bigint;
      discount?: bigint;
    }>;
  }): Promise<string> {
    const id = randomUUID();
    await prisma.order.create({
      data: {
        id,
        userId,
        regionId,
        regionName: 'ANL region',
        customerPhone: '+989121234567',
        status: input.status ?? 'DELIVERED',
        grossSubtotal: input.grossSubtotal,
        lineDiscountTotal: input.lineDiscountTotal ?? 0n,
        subtotalAfterLineDiscounts:
          input.grossSubtotal - (input.lineDiscountTotal ?? 0n),
        orderDiscountAmount: input.orderDiscountAmount ?? 0n,
        total: input.total,
        ...(input.orderDiscountAmount && input.orderDiscountAmount > 0n
          ? {
              appliedOrderDiscountId: randomUUID(),
              appliedOrderDiscountName: 'ANL order discount',
              appliedOrderDiscountType: 'FIXED',
              appliedOrderDiscountFixedAmount: Number(
                input.orderDiscountAmount,
              ),
              appliedOrderDiscountPrecedence: 1,
            }
          : {}),
        pricingEvaluatedAt: input.createdAt,
        createdAt: input.createdAt,
        deliveredAt: input.deliveredAt,
        shippedAt: input.shippedAt,
        confirmedAt: input.confirmedAt,
        cancelledAt: input.cancelledAt,
        lines: {
          create: input.lines.map((line) => ({
            productId: line.productId,
            productName: line.productName,
            unitPrice: Number(line.gross / BigInt(line.quantity)),
            quantity: line.quantity,
            discountedQuantity: line.discount ? 1 : 0,
            grossLineTotal: line.gross,
            lineDiscountAmount: line.discount ?? 0n,
            finalLineTotal: line.gross - (line.discount ?? 0n),
            ...(line.discount && line.discount > 0n
              ? {
                  appliedLineDiscountId: randomUUID(),
                  appliedLineDiscountName: 'ANL line discount',
                  appliedLineDiscountType: 'FIXED',
                  appliedLineDiscountTarget: 'PRODUCT',
                  appliedLineDiscountFixedAmount: Number(line.discount),
                  appliedLineDiscountPrecedence: 1,
                  appliedLineDiscountProductId: line.productId,
                }
              : {}),
          })),
        },
      },
    });
    return id;
  }

  it('separates lifecycle timestamps and keeps cancellation value immutable', async () => {
    const p = await product('Lifecycle');
    await order({
      createdAt: new Date('2026-08-31T12:00:00Z'),
      deliveredAt: new Date('2026-09-01T10:00:00Z'),
      total: 700n,
      grossSubtotal: 700n,
      lines: [
        { productId: p, productName: 'Lifecycle', quantity: 1, gross: 700n },
      ],
    });
    await order({
      createdAt: new Date('2026-09-01T10:00:00Z'),
      deliveredAt: new Date('2026-09-02T10:00:00Z'),
      total: 800n,
      grossSubtotal: 800n,
      lines: [
        { productId: p, productName: 'Lifecycle', quantity: 1, gross: 800n },
      ],
    });
    await order({
      createdAt: new Date('2026-08-31T12:00:00Z'),
      cancelledAt: new Date('2026-09-01T11:00:00Z'),
      status: 'CANCELLED',
      total: 900n,
      grossSubtotal: 900n,
      lines: [
        { productId: p, productName: 'Lifecycle', quantity: 1, gross: 900n },
      ],
    });
    await expect(analytics.salesOverview(DAY, DAY)).resolves.toMatchObject({
      ordersCreated: 1,
      ordersDelivered: 1,
      grossSales: 700,
      cancelledOrderValue: 900,
      ordersCancelled: 1,
    });
    await expect(
      analytics.salesOverview('2026-08-31', '2026-08-31'),
    ).resolves.toMatchObject({
      ordersCreated: 2,
      ordersDelivered: 0,
      ordersCancelled: 0,
    });
    await expect(
      analytics.salesOverview('2026-09-02', '2026-09-02'),
    ).resolves.toMatchObject({ ordersDelivered: 1 });
    await expect(
      analytics.todayPulse(new Date('2026-09-01T12:00:00Z')),
    ).resolves.toMatchObject({
      ordersCreated: 1,
      createdOrderValue: 800,
      ordersConfirmed: 0,
      ordersShipped: 0,
      ordersDelivered: 1,
      ordersCancelled: 1,
      cancelledOrderValue: 900,
      grossSales: 700,
      lineDiscounts: 0,
      orderDiscounts: 0,
      totalDiscounts: 0,
      netSales: 700,
      stockReceived: 0,
      stockShipped: 0,
      stockReturnedToStock: 0,
    });
  });

  it('reconciles integer-Toman sales arithmetic and returned delivery facts', async () => {
    const a = await product('A');
    const b = await product('B');
    await order({
      createdAt: new Date('2026-09-01T08:00:00Z'),
      deliveredAt: new Date('2026-09-01T09:00:00Z'),
      total: 900n,
      grossSubtotal: 1400n,
      lineDiscountTotal: 100n,
      orderDiscountAmount: 400n,
      lines: [
        {
          productId: a,
          productName: 'A',
          quantity: 1,
          gross: 1000n,
          discount: 100n,
        },
        { productId: b, productName: 'B', quantity: 1, gross: 400n },
      ],
    });
    const returned = await order({
      createdAt: new Date('2026-08-30T08:00:00Z'),
      deliveredAt: new Date('2026-09-01T09:00:00Z'),
      status: 'RETURNED',
      total: 500n,
      grossSubtotal: 500n,
      lines: [{ productId: a, productName: 'A', quantity: 1, gross: 500n }],
    });
    await prisma.order.update({
      where: { id: returned },
      data: { returnedAt: new Date('2026-09-02T09:00:00Z') },
    });
    const sales = await analytics.salesOverview(DAY, DAY);
    expect(sales).toMatchObject({
      grossSales: 1900,
      lineDiscounts: 100,
      orderDiscounts: 400,
      totalDiscounts: 500,
      netSales: 1400,
    });
    expect(Number(sales.grossSales) - Number(sales.totalDiscounts)).toBe(
      Number(sales.netSales),
    );
    await expect(
      analytics.topProducts(
        DAY,
        DAY,
        AnalyticsTopProductsBasis.DELIVERED_VALUE,
      ),
    ).resolves.toMatchObject({
      items: [
        { productId: a, value: 1400 },
        { productId: b, value: 400 },
      ],
    });
  });

  it('aggregates delivered and shipped bases, limits, ties, and latest historical names by productId', async () => {
    const a = await product('Current A');
    const b = await product('Current B');
    const c = await product('Current C');
    await prisma.product.update({
      where: { id: a },
      data: { name: 'Renamed current' },
    });
    await order({
      createdAt: new Date('2026-08-30T08:00:00Z'),
      shippedAt: new Date('2026-09-01T09:00:00Z'),
      status: 'SHIPPED',
      total: 100n,
      grossSubtotal: 100n,
      lines: [{ productId: a, productName: 'A', quantity: 2, gross: 100n }],
    });
    await order({
      createdAt: new Date('2026-08-30T08:00:00Z'),
      deliveredAt: new Date('2026-09-01T10:00:00Z'),
      total: 100n,
      grossSubtotal: 100n,
      lines: [{ productId: a, productName: 'A', quantity: 1, gross: 100n }],
    });
    await order({
      createdAt: new Date('2026-08-30T08:00:00Z'),
      deliveredAt: new Date('2026-09-01T13:00:00Z'),
      total: 100n,
      grossSubtotal: 100n,
      lines: [{ productId: a, productName: 'B', quantity: 1, gross: 100n }],
    });
    await order({
      createdAt: new Date('2026-08-30T08:00:00Z'),
      deliveredAt: new Date('2026-09-01T11:00:00Z'),
      total: 200n,
      grossSubtotal: 200n,
      lines: [{ productId: b, productName: 'B', quantity: 2, gross: 200n }],
    });
    await order({
      createdAt: new Date('2026-08-30T08:00:00Z'),
      deliveredAt: new Date('2026-09-01T12:00:00Z'),
      total: 200n,
      grossSubtotal: 200n,
      lines: [{ productId: c, productName: 'C', quantity: 2, gross: 200n }],
    });
    const delivered = await analytics.topProducts(DAY, DAY);
    expect(delivered.items).toHaveLength(3);
    expect(delivered.items[0]?.value).toBe(2);
    expect(delivered.items[1]?.value).toBe(2);
    expect(delivered.items[0]!.productId < delivered.items[1]!.productId).toBe(
      true,
    );
    expect(delivered.items[0]!.productId < delivered.items[2]!.productId).toBe(
      true,
    );
    expect(delivered.items.find((item) => item.productId === a)).toMatchObject({
      productName: 'B',
      value: 2,
    });
    expect(delivered.items.find((item) => item.productId === c)).toMatchObject({
      productName: 'C',
      value: 2,
    });
    await expect(
      analytics.topProducts(
        DAY,
        DAY,
        AnalyticsTopProductsBasis.SHIPPED_QUANTITY,
        1,
      ),
    ).resolves.toMatchObject({ items: [{ productId: a, value: 2 }] });
  });

  it('keeps current-state review count independent from today-created range and returns empty aggregates', async () => {
    const p = await product('Review');
    await order({
      createdAt: new Date('2026-08-31T08:00:00Z'),
      status: 'PENDING_REVIEW',
      total: 123n,
      grossSubtotal: 123n,
      lines: [
        { productId: p, productName: 'Review', quantity: 1, gross: 123n },
      ],
    });
    await expect(
      analytics.todayPulse(new Date('2026-09-01T12:00:00Z')),
    ).resolves.toMatchObject({
      awaitingReviewCurrent: 1,
      ordersCreated: 0,
      ordersDelivered: 0,
      stockReceived: 0,
    });
    await expect(
      analytics.salesOverview('2027-01-01', '2027-01-01'),
    ).resolves.toEqual({
      ordersCreated: 0,
      createdOrderValue: 0,
      ordersConfirmed: 0,
      ordersShipped: 0,
      ordersDelivered: 0,
      ordersCancelled: 0,
      cancelledOrderValue: 0,
      grossSales: 0,
      lineDiscounts: 0,
      orderDiscounts: 0,
      totalDiscounts: 0,
      netSales: 0,
    });
    await expect(
      analytics.topProducts('2027-01-01', '2027-01-01'),
    ).resolves.toEqual({
      basis: AnalyticsTopProductsBasis.DELIVERED_QUANTITY,
      items: [],
    });
  });

  it('counts Tehran-day inventory movements without leaking outside rows', async () => {
    const p = await product('Stock');
    await prisma.inventoryLedger.createMany({
      data: [
        {
          productId: p,
          type: 'RECEIVE',
          quantity: 5,
          onHandDelta: 5,
          reservedDelta: 0,
          onHandAfter: 105,
          reservedAfter: 0,
          referenceType: 'RECEIVE',
          referenceId: randomUUID(),
          actorType: 'ADMIN',
          actorId: ADMIN_ID,
          createdAt: new Date('2026-09-01T10:00:00Z'),
        },
        {
          productId: p,
          type: 'SHIP',
          quantity: 2,
          onHandDelta: -2,
          reservedDelta: 0,
          onHandAfter: 103,
          reservedAfter: 0,
          referenceType: 'ORDER',
          referenceId: randomUUID(),
          actorType: 'ADMIN',
          actorId: ADMIN_ID,
          createdAt: new Date('2026-09-01T11:00:00Z'),
        },
        {
          productId: p,
          type: 'RETURN_TO_STOCK',
          quantity: 1,
          onHandDelta: 1,
          reservedDelta: 0,
          onHandAfter: 104,
          reservedAfter: 0,
          referenceType: 'RETURN',
          referenceId: randomUUID(),
          actorType: 'ADMIN',
          actorId: ADMIN_ID,
          createdAt: new Date('2026-08-31T10:00:00Z'),
        },
      ],
    });
    await expect(
      analytics.todayPulse(new Date('2026-09-01T12:00:00Z')),
    ).resolves.toMatchObject({
      stockReceived: 5,
      stockShipped: 2,
      stockReturnedToStock: 0,
    });
  });
});

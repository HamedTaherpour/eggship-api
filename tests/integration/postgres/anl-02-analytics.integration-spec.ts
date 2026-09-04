import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { postgresIntegrationImports } from '../support/postgres-testing-module';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { AnalyticsModule } from '../../../src/modules/analytics/analytics.module';
import { AnalyticsService } from '../../../src/modules/analytics/application/analytics.service';
import { resolveAnalyticsDateRange } from '../../../src/modules/analytics/domain/business-date';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR = { actorType: 'ADMIN' as const, actorId: ADMIN_ID };

describe('ANL-02 product analytics (PostgreSQL integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let analytics: AnalyticsService;

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
      'TRUNCATE TABLE "PriceHistory", "InventoryLedger", "Inventory", "Product", "Category" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => app.close());

  async function product(
    input: {
      price?: number;
      isActive?: boolean;
      createdAt?: Date;
      withInventory?: boolean;
      onHand?: number;
      reserved?: number;
    } = {},
  ): Promise<{ id: string }> {
    const now = input.createdAt ?? new Date('2026-01-01T00:00:00.000Z');
    const category = await prisma.category.create({
      data: { name: `ANL-${randomUUID()}` },
    });
    const created = await prisma.product.create({
      data: {
        name: `Analytics product ${randomUUID()}`,
        price: input.price ?? 1000,
        categoryId: category.id,
        isActive: input.isActive ?? true,
        createdAt: now,
        updatedAt: now,
      },
    });
    if (input.withInventory !== false) {
      await prisma.inventory.create({
        data: {
          productId: created.id,
          onHand: input.onHand ?? 0,
          reserved: input.reserved ?? 0,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    return created;
  }

  async function ledger(
    productId: string,
    type: string,
    onHandDelta: number,
    createdAt: Date,
    id = randomUUID(),
    reservedDelta = 0,
  ): Promise<void> {
    const quantity = Math.max(
      Math.abs(onHandDelta),
      Math.abs(reservedDelta),
      1,
    );
    await prisma.inventoryLedger.create({
      data: {
        id,
        productId,
        type: type as never,
        quantity,
        onHandDelta,
        reservedDelta,
        onHandAfter: 0,
        reservedAfter: 0,
        referenceType: (type === 'RETURN_TO_STOCK'
          ? 'RETURN'
          : type === 'ADJUST'
            ? 'ADJUSTMENT'
            : type === 'RECEIVE'
              ? 'RECEIVE'
              : 'ORDER') as never,
        referenceId: randomUUID(),
        reason:
          type === 'WRITE_OFF' || type === 'ADJUST' ? 'ANL-02 test' : null,
        ...ACTOR,
        correlationId: null,
        createdAt,
      },
    });
  }

  it('proves current stock, inactive readability, isolation, and missing-inventory invariant', async () => {
    const active = await product({ onHand: 21, reserved: 7 });
    const inactive = await product({ isActive: false, onHand: 4, reserved: 1 });
    const isolated = await product({ onHand: 99, reserved: 3 });
    await expect(analytics.currentStock(active.id)).resolves.toMatchObject({
      onHand: 21,
      reserved: 7,
      available: 14,
    });
    await expect(analytics.currentStock(inactive.id)).resolves.toMatchObject({
      isActive: false,
      onHand: 4,
    });
    await expect(analytics.currentStock(isolated.id)).resolves.toMatchObject({
      onHand: 99,
      available: 96,
    });
    const missing = await product({ withInventory: false });
    await expect(analytics.currentStock(missing.id)).rejects.toThrow(
      'Inventory is missing',
    );
    await expect(analytics.currentStock(randomUUID())).rejects.toThrow(
      'Product not found',
    );
  });

  it('reconstructs Tehran daily physical stock with sparse carry-forward and non-physical reservations', async () => {
    const p = await product({ onHand: 127 });
    const day = (date: string, time: string): Date =>
      new Date(`${date}T${time}Z`);
    await ledger(p.id, 'RECEIVE', 10, day('2025-12-31', '20:29:59.000'));
    await ledger(p.id, 'RECEIVE', 10, day('2026-01-01', '01:00:00.000'));
    await ledger(
      p.id,
      'RESERVE',
      0,
      day('2026-01-01', '02:00:00.000'),
      randomUUID(),
      3,
    );
    await ledger(
      p.id,
      'RELEASE',
      0,
      day('2026-01-01', '03:00:00.000'),
      randomUUID(),
      -3,
    );
    await ledger(p.id, 'SHIP', -4, day('2026-01-01', '04:00:00.000'));
    await ledger(p.id, 'RETURN_TO_STOCK', 2, day('2026-01-01', '05:00:00.000'));
    await ledger(p.id, 'WRITE_OFF', -1, day('2026-01-01', '06:00:00.000'));
    await ledger(p.id, 'ADJUST', 5, day('2026-01-01', '07:00:00.000'));
    await ledger(p.id, 'ADJUST', -2, day('2026-01-01', '08:00:00.000'));
    await ledger(p.id, 'RECEIVE', 7, day('2026-01-03', '01:00:00.000'));
    await ledger(p.id, 'RECEIVE', 100, day('2026-01-04', '20:30:00.000'));
    const result = await analytics.dailyStock(p.id, '2026-01-01', '2026-01-03');
    expect(result.days).toEqual([
      expect.objectContaining({
        date: '2026-01-01',
        openingStock: 10,
        received: 10,
        shipped: 4,
        returnedToStock: 2,
        writeOff: 1,
        adjustment: 3,
        closingStock: 20,
      }),
      expect.objectContaining({
        date: '2026-01-02',
        openingStock: 20,
        closingStock: 20,
        received: 0,
        adjustment: 0,
      }),
      expect.objectContaining({
        date: '2026-01-03',
        openingStock: 20,
        received: 7,
        closingStock: 27,
      }),
    ]);
  });

  it('uses exact [start,end) Tehran boundaries and aggregates same-timestamp rows', async () => {
    const p = await product({ onHand: 108 });
    const range = resolveAnalyticsDateRange('2026-01-01', '2026-01-01');
    await ledger(p.id, 'RECEIVE', 2, new Date(range.start.getTime() - 1));
    await ledger(
      p.id,
      'RECEIVE',
      3,
      range.start,
      '00000000-0000-4000-8000-000000000001',
    );
    await ledger(
      p.id,
      'ADJUST',
      4,
      range.start,
      '00000000-0000-4000-8000-000000000002',
    );
    await ledger(p.id, 'SHIP', -1, new Date(range.end.getTime() - 1));
    await ledger(p.id, 'RECEIVE', 100, range.end);
    const result = await analytics.dailyStock(p.id, '2026-01-01', '2026-01-01');
    expect(result.days[0]).toMatchObject({
      openingStock: 2,
      received: 3,
      adjustment: 4,
      shipped: 1,
      closingStock: 8,
    });
  });

  it('preserves price anchors, same-day changes, ordering, current state, range state, and product isolation', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const p = await product({ price: 1400, createdAt });
    const other = await product({ price: 9999, createdAt });
    const noHistory = await product({ price: 777, createdAt });
    await prisma.priceHistory.createMany({
      data: [
        {
          id: '00000000-0000-4000-8000-000000000003',
          productId: p.id,
          oldPrice: 1000,
          newPrice: 1100,
          ...ACTOR,
          createdAt: new Date('2026-01-02T20:00:00.000Z'),
        },
        {
          id: '00000000-0000-4000-8000-000000000001',
          productId: p.id,
          oldPrice: 1100,
          newPrice: 1200,
          ...ACTOR,
          createdAt: new Date('2026-01-03T20:00:00.000Z'),
        },
        {
          id: '00000000-0000-4000-8000-000000000002',
          productId: p.id,
          oldPrice: 1200,
          newPrice: 1300,
          ...ACTOR,
          createdAt: new Date('2026-01-03T20:00:00.000Z'),
        },
      ],
    });
    await prisma.priceHistory.create({
      data: {
        productId: other.id,
        oldPrice: 9999,
        newPrice: 10000,
        ...ACTOR,
        createdAt: new Date('2026-01-02T12:00:00.000Z'),
      },
    });
    const result = await analytics.priceHistory(
      p.id,
      '2026-01-03',
      '2026-01-04',
    );
    expect(result.currentPrice).toBe(1400);
    expect(result.initialPrice).toMatchObject({ price: 1000, inferred: true });
    expect(result.priceAtRangeStart).toMatchObject({
      price: 1100,
      inferred: false,
    });
    expect(result.changes.map((change) => change.id)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]);
    const beforeCreation = await analytics.priceHistory(
      p.id,
      '2025-12-01',
      '2025-12-31',
    );
    expect(beforeCreation.priceAtRangeStart).toBeNull();
    expect(beforeCreation.changes).toHaveLength(0);
    expect(
      (await analytics.priceHistory(other.id, '2026-01-01', '2026-01-04'))
        .changes,
    ).toHaveLength(1);
    await expect(
      analytics.priceHistory(noHistory.id, '2026-01-01', '2026-01-04'),
    ).resolves.toMatchObject({
      currentPrice: 777,
      initialPrice: { price: 777, inferred: true },
      changes: [],
    });
  });

  it('keeps daily and price reads query-bounded', async () => {
    const p = await product({ onHand: 10 });
    const ledgerSpy = jest.spyOn(prisma.inventoryLedger, 'findMany');
    const priceSpy = jest.spyOn(prisma.priceHistory, 'findMany');
    await analytics.dailyStock(p.id, '2024-01-01', '2024-12-31');
    await analytics.priceHistory(p.id, '2024-01-01', '2024-12-31');
    expect(ledgerSpy).toHaveBeenCalledTimes(1);
    expect(priceSpy).toHaveBeenCalledTimes(1);
    ledgerSpy.mockRestore();
    priceSpy.mockRestore();
  });
});

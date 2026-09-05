import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { Prisma } from '../../../src/generated/prisma/client';
import { postgresIntegrationImports } from '../support/postgres-testing-module';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

interface ExplainRow {
  'QUERY PLAN': Array<{ Plan: PlanNode }>;
}

interface PlanNode {
  'Node Type': string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}

describe('ANL-04 analytics index and plan verification (PostgreSQL)', () => {
  jest.setTimeout(180_000);
  let app: INestApplicationContext;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: postgresIntegrationImports(),
    }).compile();
    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    await app.init();
  });

  afterAll(async () => app.close());

  it('keeps existing ledger indexes and supports a selective global recent range', async () => {
    assertDestructiveOperationsAllowed();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "InventoryLedger", "Inventory", "Product", "Category" RESTART IDENTITY CASCADE',
    );
    const category = await prisma.category.create({
      data: { name: `ANL-04-${randomUUID()}` },
    });
    const product = await prisma.product.create({
      data: {
        name: 'ANL-04 volume fixture',
        price: 1000,
        categoryId: category.id,
      },
    });
    await prisma.inventory.create({
      data: { productId: product.id, onHand: 25000, reserved: 0 },
    });

    const oldRows = Array.from({ length: 20000 }, (_, index) => ({
      id: randomUUID(),
      productId: product.id,
      type: 'RECEIVE' as const,
      quantity: 1,
      onHandDelta: 1,
      reservedDelta: 0,
      onHandAfter: index + 1,
      reservedAfter: 0,
      referenceType: 'RECEIVE' as const,
      referenceId: randomUUID(),
      actorType: 'SYSTEM' as const,
      createdAt: new Date('2025-01-01T00:00:00Z'),
    }));
    const recentRows = Array.from({ length: 100 }, (_, index) => ({
      ...oldRows[index]!,
      id: randomUUID(),
      referenceId: randomUUID(),
      createdAt: new Date(
        `2026-09-01T00:${String(index % 60).padStart(2, '0')}:00Z`,
      ),
    }));
    await prisma.inventoryLedger.createMany({
      data: [...oldRows, ...recentRows],
    });
    await prisma.$executeRawUnsafe('ANALYZE "InventoryLedger"');

    const plans = await prisma.$queryRaw<ExplainRow[]>(Prisma.sql`
      EXPLAIN (FORMAT JSON)
      SELECT COALESCE(SUM("onHandDelta") FILTER (WHERE type = 'RECEIVE'), 0)
      FROM "InventoryLedger"
      WHERE "createdAt" >= ${new Date('2026-09-01T00:00:00Z')}
        AND "createdAt" < ${new Date('2026-09-02T00:00:00Z')}
    `);
    const nodes = collectNodes(plans[0]!['QUERY PLAN'][0]!.Plan);
    expect(
      nodes.some(
        (node) => node['Index Name'] === 'InventoryLedger_createdAt_idx',
      ),
    ).toBe(true);

    const indexes = await prisma.$queryRawUnsafe<
      Array<{ indexname: string; indexdef: string }>
    >(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'InventoryLedger' ORDER BY indexname`,
    );
    expect(indexes.map((row) => row.indexname)).toEqual([
      'InventoryLedger_createdAt_idx',
      'InventoryLedger_order_event_unique',
      'InventoryLedger_pkey',
      'InventoryLedger_productId_createdAt_idx',
    ]);
    expect(
      indexes.find((row) => row.indexname === 'InventoryLedger_createdAt_idx')
        ?.indexdef,
    ).toContain('("createdAt")');
  });
});

function collectNodes(plan: PlanNode): PlanNode[] {
  return [plan, ...(plan.Plans ?? []).flatMap(collectNodes)];
}

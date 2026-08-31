import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { postgresIntegrationImports } from '../support/postgres-testing-module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

type ExplainRow = {
  'QUERY PLAN': Array<{ Plan: { 'Node Type': string } }>;
};

describe('ORD-08 PostgreSQL query analysis', () => {
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

  afterAll(async () => {
    await app.close();
  });

  it('runs EXPLAIN on representative order query shapes', async () => {
    assertDestructiveOperationsAllowed();
    const userId = randomUUID();
    const orderId = randomUUID();
    const idempotencyKey = randomUUID();
    const explain = async (query: string): Promise<ExplainRow> => {
      const rows = await prisma.$queryRawUnsafe<ExplainRow[]>(
        `EXPLAIN (FORMAT JSON) ${query}`,
      );
      return rows[0]!;
    };

    const plans = await Promise.all([
      explain(
        `SELECT "id", "status", "regionId", "regionName", "total", "createdAt" FROM "Order" WHERE "userId" = '${userId}'::uuid ORDER BY "createdAt" DESC, "id" ASC LIMIT 20 OFFSET 0`,
      ),
      explain(
        `SELECT "id", "userId", "status", "customerPhone", "regionId", "regionName", "total", "createdAt" FROM "Order" WHERE "id" = '${orderId}'::uuid`,
      ),
      explain(
        `UPDATE "Order" SET "status" = 'CONFIRMED'::"OrderStatus", "confirmedAt" = COALESCE("confirmedAt", now()) WHERE "id" = '${orderId}'::uuid AND "status" = 'PENDING_REVIEW'::"OrderStatus"`,
      ),
      explain(
        `SELECT "id" FROM "Order" WHERE "userId" = '${userId}'::uuid AND "idempotencyKey" = '${idempotencyKey}'::uuid`,
      ),
    ]);

    expect(plans).toHaveLength(4);
    expect(
      plans.every(
        (row) => row['QUERY PLAN'][0]?.Plan['Node Type'] !== undefined,
      ),
    ).toBe(true);
  });
});

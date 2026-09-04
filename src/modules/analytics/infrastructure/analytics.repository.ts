import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { AnalyticsTopProductsBasis } from '../api/dto/analytics-query.dto';

interface ProductWithInventory {
  id: string;
  name: string;
  price: number;
  isActive: boolean;
  createdAt: Date;
  inventory: { onHand: number; reserved: number; updatedAt: Date } | null;
}
interface AnalyticsLedgerRow {
  id: string;
  type: string;
  quantity: number;
  onHandDelta: number;
  createdAt: Date;
}
interface AnalyticsPriceHistoryRow {
  id: string;
  oldPrice: number;
  newPrice: number;
  createdAt: Date;
}
export interface AnalyticsSalesRow {
  ordersCreated: bigint;
  createdOrderValue: bigint;
  ordersConfirmed: bigint;
  ordersShipped: bigint;
  ordersDelivered: bigint;
  ordersCancelled: bigint;
  cancelledOrderValue: bigint;
  grossSales: bigint;
  lineDiscounts: bigint;
  orderDiscounts: bigint;
  netSales: bigint;
  awaitingReviewCurrent: bigint;
}
export interface AnalyticsTopProductRow {
  productId: string;
  productName: string;
  value: bigint;
}
export interface AnalyticsInventoryPulseRow {
  stockReceived: bigint;
  stockShipped: bigint;
  stockReturnedToStock: bigint;
}

@Injectable()
export class AnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async salesOverview(start: Date, end: Date): Promise<AnalyticsSalesRow> {
    const rows = await this.prisma.$queryRaw<AnalyticsSalesRow[]>(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE "createdAt" >= ${start} AND "createdAt" < ${end})::bigint AS "ordersCreated",
        COALESCE(SUM("total") FILTER (WHERE "createdAt" >= ${start} AND "createdAt" < ${end}), 0)::bigint AS "createdOrderValue",
        COUNT(*) FILTER (WHERE "confirmedAt" >= ${start} AND "confirmedAt" < ${end})::bigint AS "ordersConfirmed",
        COUNT(*) FILTER (WHERE "shippedAt" >= ${start} AND "shippedAt" < ${end})::bigint AS "ordersShipped",
        COUNT(*) FILTER (WHERE "deliveredAt" >= ${start} AND "deliveredAt" < ${end})::bigint AS "ordersDelivered",
        COUNT(*) FILTER (WHERE "cancelledAt" >= ${start} AND "cancelledAt" < ${end})::bigint AS "ordersCancelled",
        COALESCE(SUM("total") FILTER (WHERE "cancelledAt" >= ${start} AND "cancelledAt" < ${end}), 0)::bigint AS "cancelledOrderValue",
        COALESCE(SUM("grossSubtotal") FILTER (WHERE "deliveredAt" >= ${start} AND "deliveredAt" < ${end}), 0)::bigint AS "grossSales",
        COALESCE(SUM("lineDiscountTotal") FILTER (WHERE "deliveredAt" >= ${start} AND "deliveredAt" < ${end}), 0)::bigint AS "lineDiscounts",
        COALESCE(SUM("orderDiscountAmount") FILTER (WHERE "deliveredAt" >= ${start} AND "deliveredAt" < ${end}), 0)::bigint AS "orderDiscounts",
        COALESCE(SUM("total") FILTER (WHERE "deliveredAt" >= ${start} AND "deliveredAt" < ${end}), 0)::bigint AS "netSales"
        , COUNT(*) FILTER (WHERE status = 'PENDING_REVIEW')::bigint AS "awaitingReviewCurrent"
      FROM "Order"
    `);
    return rows[0]!;
  }

  async topProducts(
    start: Date,
    end: Date,
    basis: AnalyticsTopProductsBasis,
    limit: number,
  ): Promise<AnalyticsTopProductRow[]> {
    const event =
      basis === AnalyticsTopProductsBasis.SHIPPED_QUANTITY
        ? Prisma.sql`o."shippedAt"`
        : Prisma.sql`o."deliveredAt"`;
    const value =
      basis === AnalyticsTopProductsBasis.DELIVERED_VALUE
        ? Prisma.sql`ol."finalLineTotal"`
        : Prisma.sql`ol."quantity"`;
    return this.prisma.$queryRaw<AnalyticsTopProductRow[]>(Prisma.sql`
      WITH population AS (
        SELECT ol."productId", ol."productName", ol."createdAt" AS "lineCreatedAt", ol.id AS "lineId", o.id AS "orderId", ${event} AS "eventAt", ${value} AS value
        FROM "OrderLine" ol JOIN "Order" o ON o.id = ol."orderId"
        WHERE ${event} >= ${start} AND ${event} < ${end}
      ), totals AS (
        SELECT "productId", SUM(value)::bigint AS value FROM population GROUP BY "productId"
      ), names AS (
        SELECT DISTINCT ON ("productId") "productId", "productName"
        FROM population ORDER BY "productId", "eventAt" DESC, "lineCreatedAt" DESC, "orderId" DESC, "lineId" DESC
      )
      SELECT totals."productId", names."productName", totals.value
      FROM totals JOIN names USING ("productId")
      ORDER BY totals.value DESC, totals."productId" ASC
      LIMIT ${limit}
    `);
  }

  async inventoryPulse(
    start: Date,
    end: Date,
  ): Promise<AnalyticsInventoryPulseRow> {
    const rows = await this.prisma.$queryRaw<
      AnalyticsInventoryPulseRow[]
    >(Prisma.sql`
      SELECT
        COALESCE(SUM("onHandDelta") FILTER (WHERE type = 'RECEIVE'), 0)::bigint AS "stockReceived",
        COALESCE(SUM(ABS("onHandDelta")) FILTER (WHERE type = 'SHIP'), 0)::bigint AS "stockShipped",
        COALESCE(SUM("onHandDelta") FILTER (WHERE type = 'RETURN_TO_STOCK'), 0)::bigint AS "stockReturnedToStock"
      FROM "InventoryLedger" WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
    `);
    return rows[0]!;
  }

  findProductWithInventory(
    productId: string,
  ): Promise<ProductWithInventory | null> {
    return this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        price: true,
        isActive: true,
        createdAt: true,
        inventory: {
          select: { onHand: true, reserved: true, updatedAt: true },
        },
      },
    });
  }

  listLedgerFrom(
    productId: string,
    start: Date,
  ): Promise<AnalyticsLedgerRow[]> {
    return this.prisma.inventoryLedger.findMany({
      where: { productId, createdAt: { gte: start } },
      select: {
        id: true,
        type: true,
        quantity: true,
        onHandDelta: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  listPriceHistoryBefore(
    productId: string,
    end: Date,
  ): Promise<AnalyticsPriceHistoryRow[]> {
    return this.prisma.priceHistory.findMany({
      where: { productId, createdAt: { lt: end } },
      select: { id: true, oldPrice: true, newPrice: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
}

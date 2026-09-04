import { Injectable } from '@nestjs/common';
import { ProductNotFoundError } from '../../products/domain/product-errors';
import { AnalyticsInventoryInvariantError } from '../domain/analytics-errors';
import {
  resolveAnalyticsDateRange,
  resolveAnalyticsTodayRange,
} from '../domain/business-date';
import {
  AnalyticsRepository,
  type AnalyticsSalesRow,
} from '../infrastructure/analytics.repository';
import { AnalyticsTopProductsBasis } from '../api/dto/analytics-query.dto';
import { orderMoneyToJson } from '../../orders/domain/order-money';

export interface AnalyticsCurrentStockResult {
  productId: string;
  productName: string;
  isActive: boolean;
  onHand: number;
  reserved: number;
  available: number;
  updatedAt: Date;
}
export interface AnalyticsDailyStockDay {
  productId: string;
  date: string;
  openingStock: number;
  received: number;
  shipped: number;
  returnedToStock: number;
  writeOff: number;
  adjustment: number;
  closingStock: number;
}
export interface AnalyticsDailyStockResult {
  product: { id: string; name: string; isActive: boolean };
  days: AnalyticsDailyStockDay[];
}
export interface AnalyticsPriceHistoryResult {
  product: { id: string; name: string; isActive: boolean };
  currentPrice: number;
  initialPrice: { price: number; effectiveAt: Date; inferred: boolean };
  priceAtRangeStart: {
    price: number;
    effectiveAt: Date;
    inferred: boolean;
  } | null;
  changes: {
    id: string;
    oldPrice: number;
    newPrice: number;
    changedAt: Date;
  }[];
}
export interface AnalyticsSalesOverviewResult {
  ordersCreated: number;
  createdOrderValue: number | string;
  ordersConfirmed: number;
  ordersShipped: number;
  ordersDelivered: number;
  ordersCancelled: number;
  cancelledOrderValue: number | string;
  grossSales: number | string;
  lineDiscounts: number | string;
  orderDiscounts: number | string;
  totalDiscounts: number | string;
  netSales: number | string;
}
export interface AnalyticsTopProductsResult {
  basis: AnalyticsTopProductsBasis;
  items: { productId: string; productName: string; value: number | string }[];
}
export interface AnalyticsTodayPulseResult extends AnalyticsSalesOverviewResult {
  stockReceived: number;
  stockShipped: number;
  stockReturnedToStock: number;
  awaitingReviewCurrent: number;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly repository: AnalyticsRepository) {}

  async salesOverview(
    from: string,
    to: string,
  ): Promise<AnalyticsSalesOverviewResult> {
    const range = resolveAnalyticsDateRange(from, to);
    return mapSales(
      await this.repository.salesOverview(range.start, range.end),
    );
  }

  async topProducts(
    from: string,
    to: string,
    basis = AnalyticsTopProductsBasis.DELIVERED_QUANTITY,
    limit = 20,
  ): Promise<AnalyticsTopProductsResult> {
    const range = resolveAnalyticsDateRange(from, to);
    const rows = await this.repository.topProducts(
      range.start,
      range.end,
      basis,
      limit,
    );
    return {
      basis,
      items: rows.map((row) => ({
        productId: row.productId,
        productName: row.productName,
        value: orderMoneyToJson(row.value),
      })),
    };
  }

  async todayPulse(now = new Date()): Promise<AnalyticsTodayPulseResult> {
    const range = resolveAnalyticsTodayRange(now);
    const [sales, inventory] = await Promise.all([
      this.repository.salesOverview(range.start, range.end),
      this.repository.inventoryPulse(range.start, range.end),
    ]);
    return {
      ...mapSales(sales),
      stockReceived: normalizeInt(inventory.stockReceived),
      stockShipped: normalizeInt(inventory.stockShipped),
      stockReturnedToStock: normalizeInt(inventory.stockReturnedToStock),
      awaitingReviewCurrent: normalizeInt(sales.awaitingReviewCurrent),
    };
  }

  async currentStock(productId: string): Promise<AnalyticsCurrentStockResult> {
    const row = await this.repository.findProductWithInventory(productId);
    if (row === null) throw new ProductNotFoundError();
    if (row.inventory === null)
      throw new AnalyticsInventoryInvariantError(productId);
    return {
      productId: row.id,
      productName: row.name,
      isActive: row.isActive,
      onHand: row.inventory.onHand,
      reserved: row.inventory.reserved,
      available: row.inventory.onHand - row.inventory.reserved,
      updatedAt: row.inventory.updatedAt,
    };
  }

  async dailyStock(
    productId: string,
    from: string,
    to: string,
  ): Promise<AnalyticsDailyStockResult> {
    const range = resolveAnalyticsDateRange(from, to);
    const row = await this.repository.findProductWithInventory(productId);
    if (row === null) throw new ProductNotFoundError();
    if (row.inventory === null)
      throw new AnalyticsInventoryInvariantError(productId);
    const ledger = await this.repository.listLedgerFrom(productId, range.start);
    const futureDelta = ledger.reduce((sum, item) => sum + item.onHandDelta, 0);
    let balance = row.inventory.onHand - futureDelta;
    const days = range.dates.map((date) => ({
      productId,
      date,
      openingStock: 0,
      received: 0,
      shipped: 0,
      returnedToStock: 0,
      writeOff: 0,
      adjustment: 0,
      closingStock: 0,
    }));
    days[0]!.openingStock = balance;
    let index = 0;
    for (const item of ledger) {
      while (
        index < days.length &&
        item.createdAt >= range.boundaries[index + 1]!
      ) {
        days[index]!.closingStock = balance;
        index += 1;
        if (index < days.length) days[index]!.openingStock = balance;
      }
      if (index >= days.length) break;
      const day = days[index]!;
      if (item.type === 'RECEIVE') day.received += item.onHandDelta;
      else if (item.type === 'SHIP') day.shipped += Math.abs(item.onHandDelta);
      else if (item.type === 'RETURN_TO_STOCK')
        day.returnedToStock += item.onHandDelta;
      else if (item.type === 'WRITE_OFF')
        day.writeOff += Math.abs(item.onHandDelta);
      else if (item.type === 'ADJUST') day.adjustment += item.onHandDelta;
      balance += item.onHandDelta;
      day.closingStock = balance;
    }
    while (index < days.length) {
      days[index]!.closingStock = balance;
      index += 1;
      if (index < days.length) days[index]!.openingStock = balance;
    }
    return { product: metadata(row), days };
  }

  async priceHistory(
    productId: string,
    from: string,
    to: string,
  ): Promise<AnalyticsPriceHistoryResult> {
    const range = resolveAnalyticsDateRange(from, to);
    const row = await this.repository.findProductWithInventory(productId);
    if (row === null) throw new ProductNotFoundError();
    const history = await this.repository.listPriceHistoryBefore(
      productId,
      range.end,
    );
    const first = history[0];
    const initialPrice = {
      price: first?.oldPrice ?? row.price,
      effectiveAt: row.createdAt,
      inferred: true,
    };
    const atStart =
      row.createdAt > range.start
        ? null
        : [...history].reverse().find((item) => item.createdAt <= range.start);
    const priceAtRangeStart = atStart
      ? {
          price: atStart.newPrice,
          effectiveAt: atStart.createdAt,
          inferred: false,
        }
      : row.createdAt <= range.start
        ? initialPrice
        : null;
    return {
      product: metadata(row),
      currentPrice: row.price,
      initialPrice,
      priceAtRangeStart,
      changes: history
        .filter((item) => item.createdAt >= range.start)
        .map((item) => ({
          id: item.id,
          oldPrice: item.oldPrice,
          newPrice: item.newPrice,
          changedAt: item.createdAt,
        })),
    };
  }
}

function normalizeInt(value: bigint): number {
  const result = Number(value ?? 0n);
  if (!Number.isSafeInteger(result))
    throw new Error('Analytics integer is outside the safe range.');
  return result;
}
function mapSales(row: AnalyticsSalesRow): AnalyticsSalesOverviewResult {
  const lineDiscounts = orderMoneyToJson(row.lineDiscounts ?? 0n);
  const orderDiscounts = orderMoneyToJson(row.orderDiscounts ?? 0n);
  const total = (row.lineDiscounts ?? 0n) + (row.orderDiscounts ?? 0n);
  return {
    ordersCreated: normalizeInt(row.ordersCreated),
    createdOrderValue: orderMoneyToJson(row.createdOrderValue ?? 0n),
    ordersConfirmed: normalizeInt(row.ordersConfirmed),
    ordersShipped: normalizeInt(row.ordersShipped),
    ordersDelivered: normalizeInt(row.ordersDelivered),
    ordersCancelled: normalizeInt(row.ordersCancelled),
    cancelledOrderValue: orderMoneyToJson(row.cancelledOrderValue ?? 0n),
    grossSales: orderMoneyToJson(row.grossSales ?? 0n),
    lineDiscounts,
    orderDiscounts,
    totalDiscounts: orderMoneyToJson(total),
    netSales: orderMoneyToJson(row.netSales ?? 0n),
  };
}

function metadata(row: { id: string; name: string; isActive: boolean }): {
  id: string;
  name: string;
  isActive: boolean;
} {
  return { id: row.id, name: row.name, isActive: row.isActive };
}

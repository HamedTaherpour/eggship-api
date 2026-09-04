import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

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

@Injectable()
export class AnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

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

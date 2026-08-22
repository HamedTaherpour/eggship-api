import { Injectable } from '@nestjs/common';
import { toSkipTake, type PageResult } from '../../../common/list';
import {
  resolvePrismaConnection,
  type PrismaConnection,
} from '../../../infrastructure/database/prisma/prisma-transaction-context';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import {
  assertPriceHistoryActor,
  type PriceHistoryActorType,
} from '../domain/price-history-actor';
import type {
  AppendPriceHistoryInput,
  PriceHistoryListQuery,
  PriceHistoryRecord,
} from '../domain/price-history';
import { assertInventoryUuid } from '../../inventory/domain/inventory-quantity';
import {
  normalizeProductPrice,
  PRODUCT_PRICE_MAX_TOMAN,
  PRODUCT_PRICE_MIN_TOMAN,
} from '../../products/domain/product-price';

type PrismaPriceHistory = {
  id: string;
  productId: string;
  oldPrice: number;
  newPrice: number;
  actorType: PriceHistoryActorType;
  actorId: string;
  createdAt: Date;
};

/**
 * Append-only PriceHistory access. There are no update or delete methods.
 */
@Injectable()
export class PriceHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TransactionContext): PrismaConnection {
    return resolvePrismaConnection(this.prisma, tx);
  }

  async append(
    input: AppendPriceHistoryInput,
    tx: TransactionContext,
  ): Promise<PriceHistoryRecord> {
    const productId = assertInventoryUuid(input.productId, 'productId');
    const oldPrice = normalizeProductPrice(input.oldPrice);
    const newPrice = normalizeProductPrice(input.newPrice);
    if (oldPrice === newPrice) {
      throw new Error('Price history must record an actual price change.');
    }
    const actor = assertPriceHistoryActor({
      type: input.actorType,
      id: input.actorId,
    });

    const created = await this.db(tx).priceHistory.create({
      data: {
        productId,
        oldPrice,
        newPrice,
        actorType: actor.type,
        actorId: actor.id,
      },
    });
    return mapPriceHistory(created);
  }

  async listByProductId(
    productId: string,
    tx?: TransactionContext,
  ): Promise<PriceHistoryRecord[]> {
    const id = assertInventoryUuid(productId, 'productId');
    const rows = await this.db(tx).priceHistory.findMany({
      where: { productId: id },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(mapPriceHistory);
  }

  async countByProductId(
    productId: string,
    tx?: TransactionContext,
  ): Promise<number> {
    const id = assertInventoryUuid(productId, 'productId');
    return this.db(tx).priceHistory.count({ where: { productId: id } });
  }

  async listByProductPaginated(
    query: PriceHistoryListQuery,
    tx?: TransactionContext,
  ): Promise<PageResult<PriceHistoryRecord>> {
    const productId = assertInventoryUuid(query.productId, 'productId');
    const { skip, take } = toSkipTake({
      page: query.page,
      pageSize: query.pageSize,
    });
    const db = this.db(tx);

    const [total, rows] = await db.$transaction([
      db.priceHistory.count({ where: { productId } }),
      db.priceHistory.findMany({
        where: { productId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    ]);

    return { items: rows.map(mapPriceHistory), total };
  }
}

function mapPriceHistory(row: PrismaPriceHistory): PriceHistoryRecord {
  return {
    id: row.id,
    productId: row.productId,
    oldPrice: row.oldPrice,
    newPrice: row.newPrice,
    actorType: row.actorType,
    actorId: row.actorId,
    createdAt: row.createdAt,
  };
}

/** Exported for migration review documentation of int4 bounds alignment. */
export const PRICE_HISTORY_TOMAN_BOUNDS = {
  min: PRODUCT_PRICE_MIN_TOMAN,
  max: PRODUCT_PRICE_MAX_TOMAN,
} as const;

/** Prisma-neutral guard used in tests to assert append-only repository surface. */
export function assertPriceHistoryRepositoryIsAppendOnly(
  repository: PriceHistoryRepository,
): void {
  const forbidden = ['update', 'delete', 'upsert', 'createMany'] as const;
  for (const method of forbidden) {
    if (method in repository) {
      throw new Error(`PriceHistoryRepository must not expose ${method}.`);
    }
  }
}

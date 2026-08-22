import { Injectable } from '@nestjs/common';
import { toSkipTake, type PageResult } from '../../../common/list';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import {
  resolvePrismaConnection,
  type PrismaConnection,
} from '../../../infrastructure/database/prisma/prisma-transaction-context';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import {
  toInventoryBalance,
  type InventoryBalance,
} from '../domain/inventory-balance';
import {
  InventoryInsufficientStockError,
  InventoryInvalidAdjustmentError,
  InventoryNotFoundError,
} from '../domain/inventory-errors';
import {
  INVENTORY_INT4_MAX,
  assertAdjustmentDelta,
  assertInventoryUuid,
  assertPositiveQuantity,
} from '../domain/inventory-quantity';
import {
  assertNonEmptyProductIds,
  normalizeProductIdsForLock,
} from '../domain/lock-product-ids';
import {
  toInventoryListRecord,
  type InventoryListQuery,
  type InventoryListRecord,
  type InventoryListSortField,
} from '../domain/inventory-list';
import { translateInventoryPersistenceError } from './inventory-persistence-errors';

type RawBalanceRow = {
  productId: string;
  onHand: number | bigint;
  reserved: number | bigint;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Inventory aggregate persistence. Conditional quantity updates use tagged
 * Prisma.sql because Prisma cannot express column-comparison predicates such as
 * `onHand - reserved >= qty`. SQL does not leave this repository.
 */
@Injectable()
export class InventoryBalanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Paginated Admin inventory list. Starts from Inventory rows (every Product
   * should have one after backfill) and joins Product name/isActive in one query.
   */
  async listAdmin(
    query: InventoryListQuery,
  ): Promise<PageResult<InventoryListRecord>> {
    if (query.sortBy === 'available') {
      return this.listAdminByAvailableSort(query);
    }

    const where = buildInventoryListWhere(query);
    const { skip, take } = toSkipTake({
      page: query.page,
      pageSize: query.pageSize,
    });
    const orderBy = buildInventoryListOrderBy(query.sortBy, query.sortOrder);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.inventory.count({ where }),
      this.prisma.inventory.findMany({
        where,
        include: { product: { select: { name: true, isActive: true } } },
        orderBy,
        skip,
        take,
      }),
    ]);

    return {
      items: rows.map((row) =>
        toInventoryListRecord({
          productId: row.productId,
          productName: row.product.name,
          isActive: row.product.isActive,
          onHand: row.onHand,
          reserved: row.reserved,
          updatedAt: row.updatedAt,
        }),
      ),
      total,
    };
  }

  async findByProductId(
    productId: string,
    tx?: TransactionContext,
  ): Promise<InventoryBalance | null> {
    const id = assertInventoryUuid(productId, 'productId');
    const db = this.db(tx);
    const found = await db.inventory.findUnique({ where: { productId: id } });
    return found === null ? null : toInventoryBalance(found);
  }

  async ensureForProduct(
    productId: string,
    tx?: TransactionContext,
  ): Promise<InventoryBalance> {
    const id = assertInventoryUuid(productId, 'productId');
    try {
      const inserted = await this.updateReturning(
        tx,
        Prisma.sql`
          INSERT INTO "Inventory" (
            "productId", "onHand", "reserved", "createdAt", "updatedAt"
          )
          VALUES (${id}::uuid, 0, 0, now(), now())
          ON CONFLICT ("productId") DO NOTHING
          RETURNING "productId", "onHand", "reserved", "createdAt", "updatedAt"
        `,
      );
      if (inserted.length === 1) {
        return inserted[0]!;
      }
      const existing = await this.findByProductId(id, tx);
      if (existing === null) {
        throw new InventoryNotFoundError('Product does not exist.', {
          productId: id,
        });
      }
      return existing;
    } catch (error: unknown) {
      if (error instanceof InventoryNotFoundError) {
        throw error;
      }
      translateInventoryPersistenceError(error);
    }
  }

  /**
   * Locks Inventory rows in deterministic productId order. Requires an open
   * transaction; FOR UPDATE is released at commit otherwise.
   */
  async lockBalances(
    productIds: readonly string[],
    tx: TransactionContext,
  ): Promise<InventoryBalance[]> {
    assertNonEmptyProductIds(productIds);
    const sorted = normalizeProductIdsForLock(productIds);
    const locked: InventoryBalance[] = [];
    for (const id of sorted) {
      const rows = await this.updateReturning(
        tx,
        Prisma.sql`
          SELECT "productId", "onHand", "reserved", "createdAt", "updatedAt"
          FROM "Inventory"
          WHERE "productId" = ${id}::uuid
          FOR UPDATE
        `,
      );
      if (rows.length === 1) {
        locked.push(rows[0]!);
      }
    }
    return locked;
  }

  async reserveQuantity(
    productId: string,
    quantity: number,
    tx?: TransactionContext,
  ): Promise<InventoryBalance> {
    const id = assertInventoryUuid(productId, 'productId');
    const qty = assertPositiveQuantity(quantity);
    const rows = await this.updateReturning(
      tx,
      Prisma.sql`
        UPDATE "Inventory"
        SET "reserved" = "reserved" + ${qty},
            "updatedAt" = now()
        WHERE "productId" = ${id}::uuid
          AND ${qty} > 0
          AND "onHand" - "reserved" >= ${qty}
        RETURNING "productId", "onHand", "reserved", "createdAt", "updatedAt"
      `,
    );
    if (rows.length === 1) {
      return rows[0]!;
    }
    return this.rejectReserveMiss(id, qty, tx);
  }

  async releaseQuantity(
    productId: string,
    quantity: number,
    tx?: TransactionContext,
  ): Promise<InventoryBalance> {
    const id = assertInventoryUuid(productId, 'productId');
    const qty = assertPositiveQuantity(quantity);
    const rows = await this.updateReturning(
      tx,
      Prisma.sql`
        UPDATE "Inventory"
        SET "reserved" = "reserved" - ${qty},
            "updatedAt" = now()
        WHERE "productId" = ${id}::uuid
          AND ${qty} > 0
          AND "reserved" >= ${qty}
        RETURNING "productId", "onHand", "reserved", "createdAt", "updatedAt"
      `,
    );
    if (rows.length === 1) {
      return rows[0]!;
    }
    return this.rejectMissingOrInvalid(
      id,
      tx,
      new InventoryInvalidAdjustmentError(
        'Reserved quantity cannot be released.',
        { productId: id, quantity: qty },
      ),
    );
  }

  async shipQuantity(
    productId: string,
    quantity: number,
    tx?: TransactionContext,
  ): Promise<InventoryBalance> {
    const id = assertInventoryUuid(productId, 'productId');
    const qty = assertPositiveQuantity(quantity);
    const rows = await this.updateReturning(
      tx,
      Prisma.sql`
        UPDATE "Inventory"
        SET "onHand" = "onHand" - ${qty},
            "reserved" = "reserved" - ${qty},
            "updatedAt" = now()
        WHERE "productId" = ${id}::uuid
          AND ${qty} > 0
          AND "reserved" >= ${qty}
          AND "onHand" >= ${qty}
        RETURNING "productId", "onHand", "reserved", "createdAt", "updatedAt"
      `,
    );
    if (rows.length === 1) {
      return rows[0]!;
    }
    return this.rejectMissingOrInvalid(
      id,
      tx,
      new InventoryInvalidAdjustmentError(
        'Shipped quantity cannot be committed.',
        { productId: id, quantity: qty },
      ),
    );
  }

  async incrementOnHand(
    productId: string,
    quantity: number,
    tx?: TransactionContext,
  ): Promise<InventoryBalance> {
    const id = assertInventoryUuid(productId, 'productId');
    const qty = assertPositiveQuantity(quantity);
    const rows = await this.updateReturning(
      tx,
      Prisma.sql`
        UPDATE "Inventory"
        SET "onHand" = "onHand" + ${qty},
            "updatedAt" = now()
        WHERE "productId" = ${id}::uuid
          AND ${qty} > 0
          AND "onHand" <= ${INVENTORY_INT4_MAX} - ${qty}
        RETURNING "productId", "onHand", "reserved", "createdAt", "updatedAt"
      `,
    );
    if (rows.length === 1) {
      return rows[0]!;
    }
    return this.rejectMissingOrInvalid(
      id,
      tx,
      new InventoryInvalidAdjustmentError(
        'On-hand quantity cannot be increased.',
        { productId: id, quantity: qty },
      ),
    );
  }

  async decrementOnHand(
    productId: string,
    quantity: number,
    tx?: TransactionContext,
  ): Promise<InventoryBalance> {
    const id = assertInventoryUuid(productId, 'productId');
    const qty = assertPositiveQuantity(quantity);
    const rows = await this.updateReturning(
      tx,
      Prisma.sql`
        UPDATE "Inventory"
        SET "onHand" = "onHand" - ${qty},
            "updatedAt" = now()
        WHERE "productId" = ${id}::uuid
          AND ${qty} > 0
          AND "onHand" - ${qty} >= "reserved"
        RETURNING "productId", "onHand", "reserved", "createdAt", "updatedAt"
      `,
    );
    if (rows.length === 1) {
      return rows[0]!;
    }
    return this.rejectMissingOrInvalid(
      id,
      tx,
      new InventoryInvalidAdjustmentError(
        'On-hand quantity cannot be decreased.',
        { productId: id, quantity: qty },
      ),
    );
  }

  async adjustOnHand(
    productId: string,
    delta: number,
    tx?: TransactionContext,
  ): Promise<InventoryBalance> {
    const id = assertInventoryUuid(productId, 'productId');
    const signed = assertAdjustmentDelta(delta);
    const rows = await this.updateReturning(
      tx,
      Prisma.sql`
        UPDATE "Inventory"
        SET "onHand" = "onHand" + ${signed},
            "updatedAt" = now()
        WHERE "productId" = ${id}::uuid
          AND ${signed} <> 0
          AND CASE
            WHEN ${signed} > 0 THEN
              "onHand" <= ${INVENTORY_INT4_MAX} - ${signed}
              AND "onHand" + ${signed} >= "reserved"
            ELSE
              "onHand" + ${signed} >= 0
              AND "onHand" + ${signed} >= "reserved"
          END
        RETURNING "productId", "onHand", "reserved", "createdAt", "updatedAt"
      `,
    );
    if (rows.length === 1) {
      return rows[0]!;
    }
    return this.rejectMissingOrInvalid(
      id,
      tx,
      new InventoryInvalidAdjustmentError(
        'This inventory adjustment is not allowed.',
        { productId: id, delta: signed },
      ),
    );
  }

  private async listAdminByAvailableSort(
    query: InventoryListQuery,
  ): Promise<PageResult<InventoryListRecord>> {
    return listAdminByAvailableSortImpl(this.prisma, query);
  }

  private db(tx?: TransactionContext): PrismaConnection {
    return resolvePrismaConnection(this.prisma, tx);
  }

  private async updateReturning(
    tx: TransactionContext | undefined,
    statement: Prisma.Sql,
  ): Promise<InventoryBalance[]> {
    try {
      const rows = await this.db(tx).$queryRaw<RawBalanceRow[]>(statement);
      return rows.map(mapRawBalance);
    } catch (error: unknown) {
      translateInventoryPersistenceError(error);
    }
  }

  private async rejectReserveMiss(
    productId: string,
    quantity: number,
    tx: TransactionContext | undefined,
  ): Promise<never> {
    const existing = await this.findByProductId(productId, tx);
    if (existing === null) {
      throw new InventoryNotFoundError(
        'Inventory was not found for this product.',
        { productId },
      );
    }
    throw new InventoryInsufficientStockError(
      'Not enough available stock for this reservation.',
      {
        productId,
        requested: quantity,
      },
    );
  }

  private async rejectMissingOrInvalid(
    productId: string,
    tx: TransactionContext | undefined,
    invalid: InventoryInvalidAdjustmentError,
  ): Promise<never> {
    const existing = await this.findByProductId(productId, tx);
    if (existing === null) {
      throw new InventoryNotFoundError(
        'Inventory was not found for this product.',
        { productId },
      );
    }
    throw invalid;
  }
}

type InventoryListRow = {
  productId: string;
  onHand: number | bigint;
  reserved: number | bigint;
  updatedAt: Date;
  productName: string;
  isActive: boolean;
};

function buildInventoryListWhere(
  query: InventoryListQuery,
): Prisma.InventoryWhereInput {
  const where: Prisma.InventoryWhereInput = {};
  const productWhere: Prisma.ProductWhereInput = {};

  if (query.isActive !== undefined) {
    productWhere.isActive = query.isActive;
  }
  if (query.search !== undefined) {
    productWhere.name = { contains: query.search, mode: 'insensitive' };
  }
  if (Object.keys(productWhere).length > 0) {
    where.product = productWhere;
  }
  return where;
}

function buildInventoryListOrderBy(
  sortBy: Exclude<InventoryListSortField, 'available'>,
  sortOrder: 'asc' | 'desc',
): Prisma.InventoryOrderByWithRelationInput {
  switch (sortBy) {
    case 'productName':
      return { product: { name: sortOrder } };
    case 'onHand':
      return { onHand: sortOrder };
    case 'reserved':
      return { reserved: sortOrder };
    case 'updatedAt':
      return { updatedAt: sortOrder };
    default: {
      const exhaustive: never = sortBy;
      throw new Error(
        'Unsupported inventory list sort field: ' + String(exhaustive),
      );
    }
  }
}

async function listAdminByAvailableSortImpl(
  prisma: PrismaService,
  query: InventoryListQuery,
): Promise<PageResult<InventoryListRecord>> {
  const { skip, take } = toSkipTake({
    page: query.page,
    pageSize: query.pageSize,
  });
  const filters: Prisma.Sql[] = [Prisma.sql`TRUE`];

  if (query.isActive !== undefined) {
    filters.push(
      Prisma.sql`
        p."isActive" = ${query.isActive}
      `,
    );
  }
  if (query.search !== undefined) {
    const searchPattern = `%${query.search}%`;
    filters.push(
      Prisma.sql`
        p."name" ILIKE ${searchPattern}
      `,
    );
  }
  const whereClause = Prisma.join(filters, ' AND ');

  const [countRows, rows] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM "Inventory" i
      INNER JOIN "Product" p ON p."id" = i."productId"
      WHERE ${whereClause}
    `),
    query.sortOrder === 'asc'
      ? prisma.$queryRaw<InventoryListRow[]>(Prisma.sql`
          SELECT
            i."productId",
            i."onHand",
            i."reserved",
            i."updatedAt",
            p."name" AS "productName",
            p."isActive"
          FROM "Inventory" i
          INNER JOIN "Product" p ON p."id" = i."productId"
          WHERE ${whereClause}
          ORDER BY (i."onHand" - i."reserved") ASC, i."productId" ASC
          OFFSET ${skip}
          LIMIT ${take}
        `)
      : prisma.$queryRaw<InventoryListRow[]>(Prisma.sql`
          SELECT
            i."productId",
            i."onHand",
            i."reserved",
            i."updatedAt",
            p."name" AS "productName",
            p."isActive"
          FROM "Inventory" i
          INNER JOIN "Product" p ON p."id" = i."productId"
          WHERE ${whereClause}
          ORDER BY (i."onHand" - i."reserved") DESC, i."productId" ASC
          OFFSET ${skip}
          LIMIT ${take}
        `),
  ]);

  return {
    total: Number(countRows[0]?.count ?? 0n),
    items: rows.map((row) =>
      toInventoryListRecord({
        productId: row.productId,
        productName: row.productName,
        isActive: row.isActive,
        onHand: asInt(row.onHand),
        reserved: asInt(row.reserved),
        updatedAt: row.updatedAt,
      }),
    ),
  };
}

function mapRawBalance(row: RawBalanceRow): InventoryBalance {
  return toInventoryBalance({
    productId: row.productId,
    onHand: asInt(row.onHand),
    reserved: asInt(row.reserved),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function asInt(value: number | bigint): number {
  if (typeof value === 'bigint') {
    const converted = Number(value);
    if (!Number.isSafeInteger(converted)) {
      throw new Error('Inventory quantity is outside the safe integer range.');
    }
    return converted;
  }
  return value;
}

import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { toSkipTake, type PageResult } from '../../../common/list';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import {
  resolvePrismaConnection,
  type PrismaConnection,
} from '../../../infrastructure/database/prisma/prisma-transaction-context';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import { InventoryReservationConflictError } from '../domain/inventory-errors';
import {
  InventoryReservationStatus,
  type InventoryReservation,
} from '../domain/inventory-reservation';
import type { InventoryReservationListQuery } from '../domain/inventory-list';
import {
  assertInventoryUuid,
  assertPositiveQuantity,
} from '../domain/inventory-quantity';
import { translateInventoryPersistenceError } from './inventory-persistence-errors';

/**
 * Advisory-lock class id for order-scoped Inventory reservation operations.
 * Keyed with hashtext(orderId) so the pair stays inside int4.
 */
const INVENTORY_ORDER_ADVISORY_LOCK_CLASS = 120_300;

type PrismaReservation = {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  status: InventoryReservationStatus;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class InventoryReservationRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TransactionContext): PrismaConnection {
    return resolvePrismaConnection(this.prisma, tx);
  }

  async findById(
    id: string,
    tx?: TransactionContext,
  ): Promise<InventoryReservation | null> {
    const reservationId = assertInventoryUuid(id, 'reservationId');
    const found = await this.db(tx).inventoryReservation.findUnique({
      where: { id: reservationId },
    });
    return found === null ? null : mapReservation(found);
  }

  async findByOrderProduct(
    orderId: string,
    productId: string,
    tx?: TransactionContext,
  ): Promise<InventoryReservation | null> {
    const order = assertInventoryUuid(orderId, 'orderId');
    const product = assertInventoryUuid(productId, 'productId');
    const found = await this.db(tx).inventoryReservation.findUnique({
      where: {
        orderId_productId: { orderId: order, productId: product },
      },
    });
    return found === null ? null : mapReservation(found);
  }

  /**
   * Order-driven lookup only. UNIQUE(orderId, productId) already prefixes
   * `orderId`; do not add a duplicate index.
   */
  async findByOrderId(
    orderId: string,
    tx?: TransactionContext,
  ): Promise<InventoryReservation[]> {
    return this.loadByOrderId(orderId, false, tx);
  }

  async listByProduct(
    productId: string,
    tx?: TransactionContext,
  ): Promise<InventoryReservation[]> {
    const product = assertInventoryUuid(productId, 'productId');
    try {
      const rows = await this.db(tx).$queryRaw<PrismaReservation[]>(Prisma.sql`
        SELECT "id", "orderId", "productId", "quantity", "status", "createdAt", "updatedAt"
        FROM "InventoryReservation"
        WHERE "productId" = ${product}::uuid
        ORDER BY "orderId" ASC, "id" ASC
      `);
      return rows.map(mapReservation);
    } catch (error: unknown) {
      translateInventoryPersistenceError(error);
    }
  }

  async listByProductPaginated(
    query: InventoryReservationListQuery,
    tx?: TransactionContext,
  ): Promise<PageResult<InventoryReservation>> {
    const productId = assertInventoryUuid(query.productId, 'productId');
    const { skip, take } = toSkipTake({
      page: query.page,
      pageSize: query.pageSize,
    });
    const filters: Prisma.Sql[] = [
      Prisma.sql`
        "productId" = ${productId}::uuid
      `,
    ];
    if (query.status !== undefined) {
      filters.push(
        Prisma.sql`
          "status" = ${query.status}::"InventoryReservationStatus"
        `,
      );
    }
    const whereClause = Prisma.join(filters, ' AND ');

    try {
      const [countRows, rows] = await this.db(tx).$transaction([
        this.db(tx).$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
          SELECT COUNT(*)::bigint AS count
          FROM "InventoryReservation"
          WHERE ${whereClause}
        `),
        this.db(tx).$queryRaw<PrismaReservation[]>(Prisma.sql`
          SELECT "id", "orderId", "productId", "quantity", "status", "createdAt", "updatedAt"
          FROM "InventoryReservation"
          WHERE ${whereClause}
          ORDER BY "createdAt" DESC, "id" DESC
          OFFSET ${skip}
          LIMIT ${take}
        `),
      ]);
      return {
        total: Number(countRows[0]?.count ?? 0n),
        items: rows.map(mapReservation),
      };
    } catch (error: unknown) {
      translateInventoryPersistenceError(error);
    }
  }

  /**
   * Lock reservation rows for an order in productId order. Callers must already
   * hold Inventory row locks for those products (inventory first).
   */
  async lockByOrderId(
    orderId: string,
    tx: TransactionContext,
  ): Promise<InventoryReservation[]> {
    return this.loadByOrderId(orderId, true, tx);
  }

  /**
   * Transaction-scoped PostgreSQL advisory lock for one orderId. Serializes
   * same-order reserve/release before Inventory row locks so disjoint-SKU
   * retries cannot create a partial reservation set. Not a Redis lock.
   */
  async lockOrderScope(orderId: string, tx: TransactionContext): Promise<void> {
    const order = assertInventoryUuid(orderId, 'orderId');
    try {
      // $executeRaw: pg_advisory_xact_lock returns void; $queryRaw cannot
      // deserialize void columns under Prisma's PostgreSQL driver.
      await this.db(tx).$executeRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(
          ${INVENTORY_ORDER_ADVISORY_LOCK_CLASS},
          hashtext(${order}::text)
        )
      `);
    } catch (error: unknown) {
      translateInventoryPersistenceError(error);
    }
  }

  async insertActive(
    input: { orderId: string; productId: string; quantity: number },
    tx?: TransactionContext,
  ): Promise<{ reservation: InventoryReservation; inserted: boolean }> {
    const orderId = assertInventoryUuid(input.orderId, 'orderId');
    const productId = assertInventoryUuid(input.productId, 'productId');
    const quantity = assertPositiveQuantity(input.quantity);
    const id = randomUUID();

    try {
      const rows = await this.db(tx).$queryRaw<PrismaReservation[]>(Prisma.sql`
        INSERT INTO "InventoryReservation" (
          "id", "orderId", "productId", "quantity", "status", "createdAt", "updatedAt"
        )
        VALUES (
          ${id}::uuid,
          ${orderId}::uuid,
          ${productId}::uuid,
          ${quantity},
          'ACTIVE'::"InventoryReservationStatus",
          now(),
          now()
        )
        ON CONFLICT ("orderId", "productId") DO NOTHING
        RETURNING "id", "orderId", "productId", "quantity", "status", "createdAt", "updatedAt"
      `);
      if (rows.length === 1) {
        return { reservation: mapReservation(rows[0]!), inserted: true };
      }

      const locked = await this.db(tx).$queryRaw<
        PrismaReservation[]
      >(Prisma.sql`
        SELECT "id", "orderId", "productId", "quantity", "status", "createdAt", "updatedAt"
        FROM "InventoryReservation"
        WHERE "orderId" = ${orderId}::uuid
          AND "productId" = ${productId}::uuid
        FOR UPDATE
      `);
      const existing = locked.length === 1 ? mapReservation(locked[0]!) : null;
      if (existing === null) {
        throw new InventoryReservationConflictError(
          'A reservation already exists for this order and product.',
          { orderId, productId },
        );
      }
      if (
        existing.status !== InventoryReservationStatus.ACTIVE ||
        existing.quantity !== quantity
      ) {
        throw new InventoryReservationConflictError(
          'A reservation already exists for this order and product.',
          { orderId, productId, status: existing.status },
        );
      }
      return { reservation: existing, inserted: false };
    } catch (error: unknown) {
      translateInventoryPersistenceError(error);
    }
  }

  /**
   * ACTIVE → RELEASED | SHIPPED via conditional UPDATE. `transitioned` is true
   * only when this statement moved the row.
   */
  async transitionFromActive(
    id: string,
    to:
      | typeof InventoryReservationStatus.RELEASED
      | typeof InventoryReservationStatus.SHIPPED,
    tx?: TransactionContext,
  ): Promise<{
    reservation: InventoryReservation;
    transitioned: boolean;
  } | null> {
    const reservationId = assertInventoryUuid(id, 'reservationId');
    try {
      const result = await this.db(tx).inventoryReservation.updateMany({
        where: {
          id: reservationId,
          status: InventoryReservationStatus.ACTIVE,
        },
        data: { status: to },
      });
      const current = await this.findById(reservationId, tx);
      if (current === null) {
        return null;
      }
      return { reservation: current, transitioned: result.count === 1 };
    } catch (error: unknown) {
      translateInventoryPersistenceError(error);
    }
  }

  private async loadByOrderId(
    orderId: string,
    forUpdate: boolean,
    tx?: TransactionContext,
  ): Promise<InventoryReservation[]> {
    const order = assertInventoryUuid(orderId, 'orderId');
    try {
      const rows = forUpdate
        ? await this.db(tx).$queryRaw<PrismaReservation[]>(Prisma.sql`
            SELECT "id", "orderId", "productId", "quantity", "status", "createdAt", "updatedAt"
            FROM "InventoryReservation"
            WHERE "orderId" = ${order}::uuid
            ORDER BY "productId" ASC
            FOR UPDATE
          `)
        : await this.db(tx).$queryRaw<PrismaReservation[]>(Prisma.sql`
            SELECT "id", "orderId", "productId", "quantity", "status", "createdAt", "updatedAt"
            FROM "InventoryReservation"
            WHERE "orderId" = ${order}::uuid
            ORDER BY "productId" ASC
          `);
      return rows.map(mapReservation);
    } catch (error: unknown) {
      translateInventoryPersistenceError(error);
    }
  }
}

function mapReservation(row: PrismaReservation): InventoryReservation {
  return {
    id: row.id,
    orderId: row.orderId,
    productId: row.productId,
    quantity: row.quantity,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

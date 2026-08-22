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
  assertLedgerActor,
  assertLedgerDeltasMatchType,
  assertRequiredReason,
  normalizeLedgerReason,
  type InventoryLedgerEntry,
  type InventoryLedgerActorType,
  type InventoryLedgerReferenceType,
  type InventoryLedgerType,
} from '../domain/inventory-ledger';
import type { InventoryLedgerListQuery } from '../domain/inventory-list';
import {
  assertInventoryUuid,
  assertPositiveQuantity,
} from '../domain/inventory-quantity';
import { translateInventoryPersistenceError } from './inventory-persistence-errors';

type PrismaLedger = {
  id: string;
  productId: string;
  type: InventoryLedgerType;
  quantity: number;
  onHandDelta: number;
  reservedDelta: number;
  onHandAfter: number;
  reservedAfter: number;
  referenceType: InventoryLedgerReferenceType;
  referenceId: string | null;
  reason: string | null;
  actorType: InventoryLedgerActorType;
  actorId: string | null;
  correlationId: string | null;
  createdAt: Date;
};

export interface AppendLedgerInput {
  productId: string;
  type: InventoryLedgerType;
  quantity: number;
  onHandDelta: number;
  reservedDelta: number;
  onHandAfter: number;
  reservedAfter: number;
  referenceType: InventoryLedgerReferenceType;
  referenceId: string | null;
  reason?: string | null;
  actorType: InventoryLedgerActorType;
  actorId: string | null;
  correlationId?: string | null;
}

/**
 * Append-only InventoryLedger access. There are no update or delete methods.
 */
@Injectable()
export class InventoryLedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TransactionContext): PrismaConnection {
    return resolvePrismaConnection(this.prisma, tx);
  }

  async append(
    input: AppendLedgerInput,
    tx?: TransactionContext,
  ): Promise<InventoryLedgerEntry> {
    const productId = assertInventoryUuid(input.productId, 'productId');
    const quantity = assertPositiveQuantity(input.quantity);
    const actor = assertLedgerActor({
      type: input.actorType,
      id: input.actorId,
    });
    const reason = normalizeLedgerReason(input.reason);
    assertRequiredReason(input.type, reason);
    assertLedgerDeltasMatchType({
      type: input.type,
      quantity,
      onHandDelta: input.onHandDelta,
      reservedDelta: input.reservedDelta,
      onHandAfter: input.onHandAfter,
      reservedAfter: input.reservedAfter,
    });

    const referenceId =
      input.referenceId === null
        ? null
        : assertInventoryUuid(input.referenceId, 'referenceId');
    const correlationId =
      input.correlationId === null || input.correlationId === undefined
        ? null
        : assertInventoryUuid(input.correlationId, 'correlationId');

    try {
      const created = await this.db(tx).inventoryLedger.create({
        data: {
          productId,
          type: input.type,
          quantity,
          onHandDelta: input.onHandDelta,
          reservedDelta: input.reservedDelta,
          onHandAfter: input.onHandAfter,
          reservedAfter: input.reservedAfter,
          referenceType: input.referenceType,
          referenceId,
          reason,
          actorType: actor.type,
          actorId: actor.id,
          correlationId,
        },
      });
      return mapLedger(created);
    } catch (error: unknown) {
      translateInventoryPersistenceError(error);
    }
  }

  async findOrderEvent(
    type: InventoryLedgerType,
    orderId: string,
    productId: string,
    tx?: TransactionContext,
  ): Promise<InventoryLedgerEntry | null> {
    const referenceId = assertInventoryUuid(orderId, 'orderId');
    const id = assertInventoryUuid(productId, 'productId');
    const found = await this.db(tx).inventoryLedger.findFirst({
      where: {
        type,
        productId: id,
        referenceType: 'ORDER',
        referenceId,
      },
    });
    return found === null ? null : mapLedger(found);
  }

  async listByProduct(
    productId: string,
    tx?: TransactionContext,
  ): Promise<InventoryLedgerEntry[]> {
    const id = assertInventoryUuid(productId, 'productId');
    const rows = await this.db(tx).inventoryLedger.findMany({
      where: { productId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(mapLedger);
  }

  async listByProductPaginated(
    query: InventoryLedgerListQuery,
    tx?: TransactionContext,
  ): Promise<PageResult<InventoryLedgerEntry>> {
    const productId = assertInventoryUuid(query.productId, 'productId');
    const where = buildLedgerListWhere(productId, query);
    const { skip, take } = toSkipTake({
      page: query.page,
      pageSize: query.pageSize,
    });
    const db = this.db(tx);

    const [total, rows] = await db.$transaction([
      db.inventoryLedger.count({ where }),
      db.inventoryLedger.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    ]);

    return { items: rows.map(mapLedger), total };
  }
}

function mapLedger(row: PrismaLedger): InventoryLedgerEntry {
  return {
    id: row.id,
    productId: row.productId,
    type: row.type,
    quantity: row.quantity,
    onHandDelta: row.onHandDelta,
    reservedDelta: row.reservedDelta,
    onHandAfter: row.onHandAfter,
    reservedAfter: row.reservedAfter,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    reason: row.reason,
    actorType: row.actorType,
    actorId: row.actorId,
    correlationId: row.correlationId,
    createdAt: row.createdAt,
  };
}

function buildLedgerListWhere(
  productId: string,
  query: InventoryLedgerListQuery,
): Prisma.InventoryLedgerWhereInput {
  const where: Prisma.InventoryLedgerWhereInput = { productId };

  if (query.type !== undefined) {
    where.type = query.type;
  }

  if (query.createdFrom !== undefined || query.createdTo !== undefined) {
    where.createdAt = {
      ...(query.createdFrom === undefined ? {} : { gte: query.createdFrom }),
      ...(query.createdTo === undefined ? {} : { lte: query.createdTo }),
    };
  }

  return where;
}

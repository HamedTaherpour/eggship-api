import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { toSkipTake, type PageResult } from '../../../common/list';
import { Prisma } from '../../../generated/prisma/client';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import {
  resolvePrismaConnection,
  type PrismaConnection,
} from '../../../infrastructure/database/prisma/prisma-transaction-context';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { OrderStatus } from '../../orders/domain/order-status';
import {
  SettlementStatus,
  type SettlementListQuery,
  type SettlementRecord,
} from '../domain/settlement';

type OrderLockRow = { id: string; status: OrderStatus };

type SettlementRow = {
  id: string;
  orderId: string;
  status: SettlementStatus;
  dueAt: Date;
  settledAt: Date | null;
  settledByAdminId: string | null;
  receiptMediaId: string | null;
  receiptAttachedAt: Date | null;
  receiptAttachedByAdminId: string | null;
  createdByAdminId: string;
  createdAt: Date;
  updatedAt: Date;
  order: { status: OrderStatus; total: bigint };
};

@Injectable()
export class SettlementRepository {
  constructor(private readonly prisma: PrismaService) {}

  async lockOrder(
    orderId: string,
    tx: TransactionContext,
  ): Promise<OrderLockRow | null> {
    const rows = await this.db(tx).$queryRaw<OrderLockRow[]>(Prisma.sql`
      SELECT "id", "status"
      FROM "Order"
      WHERE "id" = ${orderId}::uuid
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  async findByOrderId(
    orderId: string,
    tx?: TransactionContext,
  ): Promise<SettlementRecord | null> {
    const row = await this.db(tx).orderSettlement.findUnique({
      where: { orderId },
      include: { order: { select: { status: true, total: true } } },
    });
    return row === null ? null : mapSettlement(row, new Date());
  }

  async findById(
    id: string,
    tx?: TransactionContext,
  ): Promise<SettlementRecord | null> {
    const row = await this.db(tx).orderSettlement.findUnique({
      where: { id },
      include: { order: { select: { status: true, total: true } } },
    });
    return row === null ? null : mapSettlement(row, new Date());
  }

  async lockForUpdate(
    id: string,
    tx: TransactionContext,
  ): Promise<SettlementRecord | null> {
    await this.db(tx).$queryRaw(Prisma.sql`
      SELECT "id" FROM "OrderSettlement" WHERE "id" = ${id}::uuid FOR UPDATE
    `);
    return this.findById(id, tx);
  }

  async list(
    query: SettlementListQuery,
  ): Promise<PageResult<SettlementRecord>> {
    const where = buildWhere(query);
    const { skip, take } = toSkipTake(query);
    const orderBy = [
      { [query.sortBy]: query.sortOrder },
      { id: 'asc' as const },
    ];
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.orderSettlement.count({ where }),
      this.prisma.orderSettlement.findMany({
        where,
        orderBy,
        skip,
        take,
        include: { order: { select: { status: true, total: true } } },
      }),
    ]);
    return {
      items: rows.map((row) => mapSettlement(row, query.now)),
      total,
    };
  }

  async create(
    input: { orderId: string; dueAt: Date; actorId: string },
    tx: TransactionContext,
  ): Promise<SettlementRecord> {
    const row = await this.db(tx).orderSettlement.create({
      data: {
        id: randomUUID(),
        orderId: input.orderId,
        dueAt: input.dueAt,
        createdByAdminId: input.actorId,
      },
      include: { order: { select: { status: true, total: true } } },
    });
    return mapSettlement(row, new Date());
  }

  async changeDueAt(
    id: string,
    dueAt: Date,
    tx: TransactionContext,
  ): Promise<{ record: SettlementRecord; previousDueAt: Date } | null> {
    const rows = await this.db(tx).$queryRaw<
      Array<{ id: string; previousDueAt: Date }>
    >(Prisma.sql`
      WITH prior AS (
        SELECT "id", "dueAt"
        FROM "OrderSettlement"
        WHERE "id" = ${id}::uuid
        FOR UPDATE
      ), updated AS (
        UPDATE "OrderSettlement" AS settlement
        SET "dueAt" = ${dueAt}, "updatedAt" = now()
        FROM prior
        WHERE settlement."id" = prior."id"
          AND settlement."status" = ${SettlementStatus.OPEN}::"OrderSettlementStatus"
        RETURNING settlement."id", prior."dueAt" AS "previousDueAt"
      )
      SELECT * FROM updated
    `);
    const changed = rows[0];
    if (changed === undefined) return null;
    const record = await this.findById(id, tx);
    if (record === null)
      throw new Error('Settlement disappeared after due-date update.');
    return { record, previousDueAt: changed.previousDueAt };
  }

  async attachReceipt(
    id: string,
    mediaId: string,
    actorId: string,
    tx: TransactionContext,
  ): Promise<{
    record: SettlementRecord;
    previousReceiptMediaId: string | null;
  } | null> {
    const rows = await this.db(tx).$queryRaw<
      Array<{ id: string; previousReceiptMediaId: string | null }>
    >(Prisma.sql`
      WITH prior AS (
        SELECT "id", "receiptMediaId"
        FROM "OrderSettlement"
        WHERE "id" = ${id}::uuid
        FOR UPDATE
      ), updated AS (
        UPDATE "OrderSettlement" AS settlement
        SET
          "receiptMediaId" = ${mediaId}::uuid,
          "receiptAttachedAt" = now(),
          "receiptAttachedByAdminId" = ${actorId}::uuid,
          "updatedAt" = now()
        FROM prior
        WHERE settlement."id" = prior."id"
          AND settlement."status" = ${SettlementStatus.OPEN}::"OrderSettlementStatus"
          AND settlement."receiptMediaId" IS DISTINCT FROM ${mediaId}::uuid
        RETURNING settlement."id", prior."receiptMediaId" AS "previousReceiptMediaId"
      )
      SELECT * FROM updated
    `);
    const changed = rows[0];
    if (changed === undefined) return null;
    const record = await this.findById(id, tx);
    if (record === null)
      throw new Error('Settlement disappeared after receipt update.');
    return { record, previousReceiptMediaId: changed.previousReceiptMediaId };
  }

  async markSettled(
    id: string,
    actorId: string,
    tx: TransactionContext,
  ): Promise<SettlementRecord | null> {
    const rows = await this.db(tx).$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "OrderSettlement"
      SET
        "status" = ${SettlementStatus.SETTLED}::"OrderSettlementStatus",
        "settledAt" = now(),
        "settledByAdminId" = ${actorId}::uuid,
        "updatedAt" = now()
      WHERE "id" = ${id}::uuid
        AND "status" = ${SettlementStatus.OPEN}::"OrderSettlementStatus"
        AND "receiptMediaId" IS NOT NULL
      RETURNING "id"
    `);
    return rows.length === 0 ? null : this.findById(id, tx);
  }

  private db(tx?: TransactionContext): PrismaConnection {
    return resolvePrismaConnection(this.prisma, tx);
  }
}

function buildWhere(
  query: SettlementListQuery,
): Prisma.OrderSettlementWhereInput {
  const where: Prisma.OrderSettlementWhereInput = {};
  if (query.status !== undefined) where.status = query.status;
  if (query.orderId !== undefined) where.orderId = query.orderId;
  if (query.dueFrom !== undefined || query.dueTo !== undefined) {
    where.dueAt = {
      ...(query.dueFrom === undefined ? {} : { gte: query.dueFrom }),
      ...(query.dueTo === undefined ? {} : { lte: query.dueTo }),
    };
  }
  if (query.overdue === true) {
    where.AND = [
      { status: SettlementStatus.OPEN },
      { dueAt: { lt: query.now } },
    ];
  } else if (query.overdue === false) {
    where.OR = [
      { status: SettlementStatus.SETTLED },
      { dueAt: { gte: query.now } },
    ];
  }
  return where;
}

function mapSettlement(row: SettlementRow, now: Date): SettlementRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    orderStatus: row.order.status,
    orderTotal: row.order.total,
    status: row.status,
    dueAt: row.dueAt,
    overdue: row.status === SettlementStatus.OPEN && row.dueAt < now,
    settledAt: row.settledAt,
    settledByAdminId: row.settledByAdminId,
    receiptMediaId: row.receiptMediaId,
    receiptAttachedAt: row.receiptAttachedAt,
    receiptAttachedByAdminId: row.receiptAttachedByAdminId,
    createdByAdminId: row.createdByAdminId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function isSettlementUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ((error as { code?: unknown }).code === 'P2002' ||
      (error as { code?: unknown }).code === '23505')
  );
}

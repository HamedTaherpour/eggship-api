import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import {
  resolvePrismaConnection,
  type PrismaConnection,
} from '../../../infrastructure/database/prisma/prisma-transaction-context';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import {
  assertOrderReturnInput,
  normalizeOrderReturnReason,
  type CreateOrderReturnInput,
  type OrderReturnRecord,
} from '../domain/order-return';

type ReturnWithLines = Prisma.OrderReturnGetPayload<{
  include: { lines: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } };
}>;

/** Persistence boundary for the ORD-07 return aggregate. */
@Injectable()
export class OrderReturnRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(
    id: string,
    tx?: TransactionContext,
  ): Promise<OrderReturnRecord | null> {
    const row = await this.db(tx).orderReturn.findUnique({
      where: { id },
      include: { lines: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    return row === null ? null : mapReturn(row);
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
    tx?: TransactionContext,
  ): Promise<OrderReturnRecord | null> {
    const row = await this.db(tx).orderReturn.findUnique({
      where: { idempotencyKey },
      include: { lines: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    return row === null ? null : mapReturn(row);
  }

  /** Locks an existing idempotency claim; callers must already own a transaction. */
  async lockByIdempotencyKey(
    idempotencyKey: string,
    tx: TransactionContext,
  ): Promise<OrderReturnRecord | null> {
    const rows = await this.db(tx).$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "OrderReturn" WHERE "idempotencyKey" = ${idempotencyKey}::uuid FOR UPDATE`,
    );
    return rows.length === 0 ? null : this.findById(rows[0]!.id, tx);
  }

  /**
   * Creates a complete return event atomically in the caller-owned transaction.
   * No cumulative quantity check is performed here: Slice 2 must lock the Order
   * first and enforce that cross-row invariant in the same transaction.
   */
  async createWithLines(
    input: CreateOrderReturnInput,
    tx: TransactionContext,
  ): Promise<OrderReturnRecord> {
    assertOrderReturnInput(input);
    const created = await this.db(tx).orderReturn.create({
      data: {
        id: randomUUID(),
        orderId: input.orderId,
        recordedByAdminId: input.recordedByAdminId,
        reason: normalizeOrderReturnReason(input.reason),
        idempotencyKey: input.idempotencyKey,
        idempotencyPayloadHash: input.idempotencyPayloadHash,
        lines: {
          create: input.lines.map((line) => ({
            id: randomUUID(),
            orderLineId: line.orderLineId,
            sellableQuantity: line.sellableQuantity,
            damagedQuantity: line.damagedQuantity,
          })),
        },
      },
      include: { lines: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    return mapReturn(created);
  }

  async listByOrderId(
    orderId: string,
    tx?: TransactionContext,
  ): Promise<OrderReturnRecord[]> {
    const rows = await this.db(tx).orderReturn.findMany({
      where: { orderId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { lines: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    return rows.map(mapReturn);
  }

  /**
   * Returns the cumulative inspected quantity for a line. Slice 2 must call
   * this after the canonical Order row lock and before createWithLines.
   */
  async sumReturnedQuantityByOrderLine(
    orderLineId: string,
    tx: TransactionContext,
  ): Promise<number> {
    const rows = await this.db(tx).$queryRaw<Array<{ total: bigint | null }>>(
      Prisma.sql`
        SELECT COALESCE(SUM("sellableQuantity" + "damagedQuantity"), 0)::bigint AS "total"
        FROM "OrderReturnLine"
        WHERE "orderLineId" = ${orderLineId}::uuid
      `,
    );
    const total = rows[0]?.total ?? 0n;
    const result = Number(total);
    if (!Number.isSafeInteger(result)) {
      throw new Error('Returned quantity is outside the safe integer range.');
    }
    return result;
  }

  private db(tx?: TransactionContext): PrismaConnection {
    return resolvePrismaConnection(this.prisma, tx);
  }
}

function mapReturn(row: ReturnWithLines): OrderReturnRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    recordedByAdminId: row.recordedByAdminId,
    reason: row.reason,
    idempotencyKey: row.idempotencyKey,
    idempotencyPayloadHash: row.idempotencyPayloadHash,
    createdAt: row.createdAt,
    lines: row.lines.map((line) => ({
      id: line.id,
      returnId: line.returnId,
      orderLineId: line.orderLineId,
      sellableQuantity: line.sellableQuantity,
      damagedQuantity: line.damagedQuantity,
      createdAt: line.createdAt,
    })),
  };
}

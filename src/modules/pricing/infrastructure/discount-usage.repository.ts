import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { resolvePrismaConnection } from '../../../infrastructure/database/prisma/prisma-transaction-context';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import { DiscountUsageConflictError } from '../domain/discount-errors';
import {
  DiscountUsageRecordKind,
  type DiscountCustomerUsageRecord,
  type DiscountUsageConsumeIntent,
  type DiscountUsageRecord,
} from '../domain/discount-usage';

type UsageRow = {
  discountId: string;
  userId: string;
  consumedQuantity: number;
  createdAt: Date;
  updatedAt: Date;
};

type RecordRow = {
  id: string;
  discountId: string;
  userId: string;
  orderId: string;
  kind: DiscountUsageRecordKind;
  quantity: number;
  createdAt: Date;
};

/**
 * PostgreSQL-authoritative lifetime discount usage (DLU-02 / ADR 0017).
 * Locks aggregates FOR UPDATE in sorted discountId order; append-only records.
 */
@Injectable()
export class DiscountUsageRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ensure aggregate rows exist, then lock them in ascending discountId order.
   * Returns consumedQuantity by discountId for the given user.
   */
  async lockUsageAggregates(
    userId: string,
    discountIds: readonly string[],
    tx: TransactionContext,
  ): Promise<Map<string, number>> {
    const sorted = [...new Set(discountIds)].sort((a, b) => a.localeCompare(b));
    const consumedByDiscountId = new Map<string, number>();
    if (sorted.length === 0) {
      return consumedByDiscountId;
    }

    const db = resolvePrismaConnection(this.prisma, tx);

    for (const discountId of sorted) {
      await db.$executeRaw`
        INSERT INTO "DiscountCustomerUsage" (
          "discountId",
          "userId",
          "consumedQuantity",
          "createdAt",
          "updatedAt"
        )
        VALUES (
          ${discountId}::uuid,
          ${userId}::uuid,
          0,
          now(),
          now()
        )
        ON CONFLICT ("discountId", "userId") DO NOTHING
      `;

      const rows = await db.$queryRaw<UsageRow[]>`
        SELECT
          "discountId",
          "userId",
          "consumedQuantity",
          "createdAt",
          "updatedAt"
        FROM "DiscountCustomerUsage"
        WHERE "discountId" = ${discountId}::uuid
          AND "userId" = ${userId}::uuid
        FOR UPDATE
      `;

      if (rows.length !== 1) {
        throw new DiscountUsageConflictError();
      }
      consumedByDiscountId.set(discountId, rows[0]!.consumedQuantity);
    }

    return consumedByDiscountId;
  }

  async consumeForOrder(
    input: {
      orderId: string;
      userId: string;
      consumptions: readonly DiscountUsageConsumeIntent[];
    },
    tx: TransactionContext,
  ): Promise<void> {
    if (input.consumptions.length === 0) {
      return;
    }

    const sorted = [...input.consumptions].sort((left, right) =>
      left.discountId.localeCompare(right.discountId),
    );
    const db = resolvePrismaConnection(this.prisma, tx);

    for (const consumption of sorted) {
      if (!Number.isInteger(consumption.quantity) || consumption.quantity < 1) {
        throw new DiscountUsageConflictError();
      }

      const inserted = await db.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "DiscountUsageRecord" (
          "id",
          "discountId",
          "userId",
          "orderId",
          "kind",
          "quantity",
          "createdAt"
        )
        VALUES (
          ${randomUUID()}::uuid,
          ${consumption.discountId}::uuid,
          ${input.userId}::uuid,
          ${input.orderId}::uuid,
          ${DiscountUsageRecordKind.CONSUME}::"DiscountUsageRecordKind",
          ${consumption.quantity},
          now()
        )
        ON CONFLICT ("orderId", "discountId", "kind") DO NOTHING
        RETURNING "id"
      `;

      if (inserted.length === 0) {
        // Idempotent replay — aggregate already reflects the prior CONSUME.
        continue;
      }

      const updated = await db.$executeRaw`
        UPDATE "DiscountCustomerUsage"
        SET
          "consumedQuantity" = "consumedQuantity" + ${consumption.quantity},
          "updatedAt" = now()
        WHERE "discountId" = ${consumption.discountId}::uuid
          AND "userId" = ${input.userId}::uuid
          AND "consumedQuantity" >= 0
      `;

      if (Number(updated) !== 1) {
        throw new DiscountUsageConflictError();
      }
    }
  }

  /**
   * Release this order's CONSUME quantities (pre-SHIPPED cancel).
   * Idempotent: existing RELEASE rows skip aggregate decrement.
   * Locks aggregates in sorted discountId order before Inventory.
   */
  async releaseForOrder(
    input: { orderId: string; userId: string },
    tx: TransactionContext,
  ): Promise<void> {
    const db = resolvePrismaConnection(this.prisma, tx);

    const consumes = await db.$queryRaw<RecordRow[]>`
      SELECT
        "id",
        "discountId",
        "userId",
        "orderId",
        "kind",
        "quantity",
        "createdAt"
      FROM "DiscountUsageRecord"
      WHERE "orderId" = ${input.orderId}::uuid
        AND "kind" = ${DiscountUsageRecordKind.CONSUME}::"DiscountUsageRecordKind"
      ORDER BY "discountId" ASC
    `;

    if (consumes.length === 0) {
      return;
    }

    const discountIds = consumes.map((row) => row.discountId);
    await this.lockUsageAggregates(input.userId, discountIds, tx);

    for (const consume of consumes) {
      if (consume.userId !== input.userId) {
        throw new DiscountUsageConflictError();
      }

      const inserted = await db.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "DiscountUsageRecord" (
          "id",
          "discountId",
          "userId",
          "orderId",
          "kind",
          "quantity",
          "createdAt"
        )
        VALUES (
          ${randomUUID()}::uuid,
          ${consume.discountId}::uuid,
          ${input.userId}::uuid,
          ${input.orderId}::uuid,
          ${DiscountUsageRecordKind.RELEASE}::"DiscountUsageRecordKind",
          ${consume.quantity},
          now()
        )
        ON CONFLICT ("orderId", "discountId", "kind") DO NOTHING
        RETURNING "id"
      `;

      if (inserted.length === 0) {
        continue;
      }

      const updated = await db.$executeRaw`
        UPDATE "DiscountCustomerUsage"
        SET
          "consumedQuantity" = "consumedQuantity" - ${consume.quantity},
          "updatedAt" = now()
        WHERE "discountId" = ${consume.discountId}::uuid
          AND "userId" = ${input.userId}::uuid
          AND "consumedQuantity" >= ${consume.quantity}
      `;

      if (Number(updated) !== 1) {
        throw new DiscountUsageConflictError();
      }
    }
  }

  async findUsage(
    discountId: string,
    userId: string,
    tx?: TransactionContext,
  ): Promise<DiscountCustomerUsageRecord | null> {
    const db = resolvePrismaConnection(this.prisma, tx);
    const rows = await db.$queryRaw<UsageRow[]>`
      SELECT
        "discountId",
        "userId",
        "consumedQuantity",
        "createdAt",
        "updatedAt"
      FROM "DiscountCustomerUsage"
      WHERE "discountId" = ${discountId}::uuid
        AND "userId" = ${userId}::uuid
    `;
    if (rows.length === 0) {
      return null;
    }
    return mapUsage(rows[0]!);
  }

  async listRecordsForOrder(
    orderId: string,
    tx?: TransactionContext,
  ): Promise<DiscountUsageRecord[]> {
    const db = resolvePrismaConnection(this.prisma, tx);
    const rows = await db.$queryRaw<RecordRow[]>`
      SELECT
        "id",
        "discountId",
        "userId",
        "orderId",
        "kind",
        "quantity",
        "createdAt"
      FROM "DiscountUsageRecord"
      WHERE "orderId" = ${orderId}::uuid
      ORDER BY "discountId" ASC, "kind" ASC
    `;
    return rows.map(mapRecord);
  }
}

function mapUsage(row: UsageRow): DiscountCustomerUsageRecord {
  return {
    discountId: row.discountId,
    userId: row.userId,
    consumedQuantity: row.consumedQuantity,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRecord(row: RecordRow): DiscountUsageRecord {
  return {
    id: row.id,
    discountId: row.discountId,
    userId: row.userId,
    orderId: row.orderId,
    kind: row.kind,
    quantity: row.quantity,
    createdAt: row.createdAt,
  };
}

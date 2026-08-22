import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import {
  resolvePrismaConnection,
  type PrismaConnection,
} from '../../../infrastructure/database/prisma/prisma-transaction-context';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import {
  InventoryCommandIdempotencyStatus,
  InventoryCommandOperation,
  type InventoryCommandIdempotencyRecord,
} from '../domain/inventory-command-idempotency';
import { assertInventoryUuid } from '../domain/inventory-quantity';
import { translateInventoryPersistenceError } from './inventory-persistence-errors';

type RawIdempotencyRow = {
  id: string;
  idempotencyKey: string;
  operation: InventoryCommandOperation;
  productId: string;
  payloadHash: string;
  status: InventoryCommandIdempotencyStatus;
  onHandAfter: number | bigint | null;
  reservedAfter: number | bigint | null;
  ledgerId: string | null;
  createdAt: Date;
};

export interface InsertPendingIdempotencyInput {
  idempotencyKey: string;
  operation: InventoryCommandOperation;
  productId: string;
  payloadHash: string;
}

export interface CompleteIdempotencyInput {
  idempotencyKey: string;
  onHandAfter: number;
  reservedAfter: number;
  ledgerId: string;
}

@Injectable()
export class InventoryCommandIdempotencyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByKeyForUpdate(
    idempotencyKey: string,
    tx: TransactionContext,
  ): Promise<InventoryCommandIdempotencyRecord | null> {
    const key = assertInventoryUuid(idempotencyKey, 'idempotencyKey');
    const rows = await this.queryReturning(
      tx,
      Prisma.sql`
        SELECT
          "id",
          "idempotencyKey",
          "operation",
          "productId",
          "payloadHash",
          "status",
          "onHandAfter",
          "reservedAfter",
          "ledgerId",
          "createdAt"
        FROM "InventoryCommandIdempotency"
        WHERE "idempotencyKey" = ${key}::uuid
        FOR UPDATE
      `,
    );
    return rows.length === 1 ? mapRow(rows[0]!) : null;
  }

  async insertPending(
    input: InsertPendingIdempotencyInput,
    tx: TransactionContext,
  ): Promise<InventoryCommandIdempotencyRecord | null> {
    const idempotencyKey = assertInventoryUuid(
      input.idempotencyKey,
      'idempotencyKey',
    );
    const productId = assertInventoryUuid(input.productId, 'productId');
    const id = randomUUID();

    try {
      const rows = await this.queryReturning(
        tx,
        Prisma.sql`
          INSERT INTO "InventoryCommandIdempotency" (
            "id",
            "idempotencyKey",
            "operation",
            "productId",
            "payloadHash",
            "status",
            "createdAt"
          )
          VALUES (
            ${id}::uuid,
            ${idempotencyKey}::uuid,
            ${input.operation}::"InventoryCommandOperation",
            ${productId}::uuid,
            ${input.payloadHash},
            ${InventoryCommandIdempotencyStatus.PENDING}::"InventoryCommandIdempotencyStatus",
            now()
          )
          ON CONFLICT ("idempotencyKey") DO NOTHING
          RETURNING
            "id",
            "idempotencyKey",
            "operation",
            "productId",
            "payloadHash",
            "status",
            "onHandAfter",
            "reservedAfter",
            "ledgerId",
            "createdAt"
        `,
      );
      return rows.length === 1 ? rows[0]! : null;
    } catch (error: unknown) {
      translateInventoryPersistenceError(error);
    }
  }

  async markCompleted(
    input: CompleteIdempotencyInput,
    tx: TransactionContext,
  ): Promise<InventoryCommandIdempotencyRecord> {
    const idempotencyKey = assertInventoryUuid(
      input.idempotencyKey,
      'idempotencyKey',
    );
    const ledgerId = assertInventoryUuid(input.ledgerId, 'ledgerId');

    try {
      const updated = await this.db(tx).inventoryCommandIdempotency.update({
        where: { idempotencyKey },
        data: {
          status: InventoryCommandIdempotencyStatus.COMPLETED,
          onHandAfter: input.onHandAfter,
          reservedAfter: input.reservedAfter,
          ledgerId,
        },
      });
      return mapPrismaRow(updated);
    } catch (error: unknown) {
      translateInventoryPersistenceError(error);
    }
  }

  private db(tx: TransactionContext): PrismaConnection {
    return resolvePrismaConnection(this.prisma, tx);
  }

  private async queryReturning(
    tx: TransactionContext,
    statement: Prisma.Sql,
  ): Promise<InventoryCommandIdempotencyRecord[]> {
    try {
      const rows = await this.db(tx).$queryRaw<RawIdempotencyRow[]>(statement);
      return rows.map(mapRow);
    } catch (error: unknown) {
      translateInventoryPersistenceError(error);
    }
  }
}

function mapRow(row: RawIdempotencyRow): InventoryCommandIdempotencyRecord {
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    operation: row.operation,
    productId: row.productId,
    payloadHash: row.payloadHash,
    status: row.status,
    onHandAfter: row.onHandAfter === null ? null : asInt(row.onHandAfter),
    reservedAfter: row.reservedAfter === null ? null : asInt(row.reservedAfter),
    ledgerId: row.ledgerId,
    createdAt: row.createdAt,
  };
}

function mapPrismaRow(row: {
  id: string;
  idempotencyKey: string;
  operation: InventoryCommandOperation;
  productId: string;
  payloadHash: string;
  status: InventoryCommandIdempotencyStatus;
  onHandAfter: number | null;
  reservedAfter: number | null;
  ledgerId: string | null;
  createdAt: Date;
}): InventoryCommandIdempotencyRecord {
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    operation: row.operation,
    productId: row.productId,
    payloadHash: row.payloadHash,
    status: row.status,
    onHandAfter: row.onHandAfter,
    reservedAfter: row.reservedAfter,
    ledgerId: row.ledgerId,
    createdAt: row.createdAt,
  };
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

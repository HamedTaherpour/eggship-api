import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import {
  resolvePrismaConnection,
  type PrismaConnection,
} from '../../../infrastructure/database/prisma/prisma-transaction-context';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import { assertPositiveQuantity } from '../../inventory/domain/inventory-quantity';
import { normalizeOrderLineProductName } from '../domain/order-line-name';
import { computeLineTotal, sumOrderLineTotals } from '../domain/order-money';
import {
  OrderIdempotencyConflictError,
  OrderInvalidInputError,
  OrderInvalidLineError,
  OrderInvalidProductError,
  OrderInvalidRegionError,
  OrderInvalidUserError,
} from '../domain/order-errors';
import {
  assertOptionalIdempotencyKey,
  assertOrderUuid,
  normalizeCustomerPhoneSnapshot,
  normalizeRegionNameSnapshot,
} from '../domain/order-snapshot';
import { OrderStatus } from '../domain/order-status';
import type {
  CreateOrderInput,
  CreateOrderLineInput,
  OrderLineRecord,
  OrderRecord,
} from '../domain/order';

type PrismaOrderWithLines = {
  id: string;
  userId: string;
  status: string;
  customerPhone: string;
  regionId: string;
  regionName: string;
  subtotal: bigint;
  total: bigint;
  idempotencyKey: string | null;
  deliveryAt: Date | null;
  confirmedAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  lines: Array<{
    id: string;
    orderId: string;
    productId: string;
    productName: string;
    unitPrice: number;
    quantity: number;
    lineTotal: bigint;
    createdAt: Date;
  }>;
};

type OrderTransitionWin = { id: string };

type ClosedOrderTransition =
  | {
      kind: 'pending_to_confirmed';
      orderId: string;
      deliveryAt: Date | undefined;
    }
  | {
      kind: 'pending_to_cancelled';
      orderId: string;
      userId?: string;
      cancelReason: string | null;
    }
  | {
      kind: 'confirmed_to_cancelled';
      orderId: string;
      cancelReason: string | null;
    }
  | {
      kind: 'confirmed_to_shipped';
      orderId: string;
    }
  | {
      kind: 'shipped_to_delivered';
      orderId: string;
    };

/**
 * Narrow persistence boundary for Order + OrderLine. Prisma types stay here.
 * Snapshot fields have no generic update. Status changes only through the
 * closed conditional UPDATE primitives below — never a generic status setter.
 */
@Injectable()
export class OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TransactionContext): PrismaConnection {
    return resolvePrismaConnection(this.prisma, tx);
  }

  async findById(
    id: string,
    tx?: TransactionContext,
  ): Promise<OrderRecord | null> {
    const found = await this.db(tx).order.findUnique({
      where: { id },
      include: { lines: { orderBy: { createdAt: 'asc' } } },
    });
    return found === null ? null : mapOrder(found);
  }

  /**
   * Owner-scoped lookup for customer reads and customer-cancel classification
   * (BOLA/IDOR-safe path). Missing and other-owner both return null.
   */
  async findOwnedById(
    orderId: string,
    userId: string,
    tx?: TransactionContext,
  ): Promise<OrderRecord | null> {
    const found = await this.db(tx).order.findFirst({
      where: {
        id: assertOrderUuid(orderId, 'orderId'),
        userId: assertOrderUuid(userId, 'userId'),
      },
      include: { lines: { orderBy: { createdAt: 'asc' } } },
    });
    return found === null ? null : mapOrder(found);
  }

  async transitionPendingToConfirmed(
    orderId: string,
    input: { deliveryAt?: Date },
    tx?: TransactionContext,
  ): Promise<OrderRecord | null> {
    return this.transition(
      {
        kind: 'pending_to_confirmed',
        orderId,
        deliveryAt: input.deliveryAt,
      },
      tx,
    );
  }

  async transitionPendingToCancelled(
    orderId: string,
    input: { cancelReason: string | null },
    tx?: TransactionContext,
  ): Promise<OrderRecord | null> {
    return this.transition(
      {
        kind: 'pending_to_cancelled',
        orderId,
        cancelReason: input.cancelReason,
      },
      tx,
    );
  }

  /**
   * Customer cancel primitive: PENDING_REVIEW → CANCELLED for this owner only.
   * Cannot cancel CONFIRMED even if the caller is the owner.
   */
  async transitionPendingToCancelledForOwner(
    orderId: string,
    userId: string,
    tx?: TransactionContext,
  ): Promise<OrderRecord | null> {
    return this.transition(
      {
        kind: 'pending_to_cancelled',
        orderId,
        userId: assertOrderUuid(userId, 'userId'),
        cancelReason: null,
      },
      tx,
    );
  }

  async transitionConfirmedToCancelled(
    orderId: string,
    input: { cancelReason: string | null },
    tx?: TransactionContext,
  ): Promise<OrderRecord | null> {
    return this.transition(
      {
        kind: 'confirmed_to_cancelled',
        orderId,
        cancelReason: input.cancelReason,
      },
      tx,
    );
  }

  async transitionConfirmedToShipped(
    orderId: string,
    tx?: TransactionContext,
  ): Promise<OrderRecord | null> {
    return this.transition({ kind: 'confirmed_to_shipped', orderId }, tx);
  }

  async transitionShippedToDelivered(
    orderId: string,
    tx?: TransactionContext,
  ): Promise<OrderRecord | null> {
    return this.transition({ kind: 'shipped_to_delivered', orderId }, tx);
  }

  /**
   * Atomic `UPDATE ... WHERE status = expectedFrom RETURNING`. Zero rows means
   * the caller must re-read and classify (replay vs invalid vs missing).
   */
  private async transition(
    spec: ClosedOrderTransition,
    tx?: TransactionContext,
  ): Promise<OrderRecord | null> {
    const orderId = assertOrderUuid(spec.orderId, 'orderId');
    const rows = await this.db(tx).$queryRaw<OrderTransitionWin[]>(
      buildTransitionSql(orderId, spec),
    );
    if (rows.length === 0) {
      return null;
    }
    const loaded = await this.findById(orderId, tx);
    if (loaded === null) {
      throw new Error('Order disappeared after a winning conditional update.');
    }
    return loaded;
  }

  /**
   * Atomic order + line creation. Computes lineTotal/subtotal/total server-side.
   */
  async createWithLines(
    input: CreateOrderInput,
    tx?: TransactionContext,
  ): Promise<OrderRecord> {
    const normalized = normalizeCreateOrderInput(input);
    const db = resolvePrismaConnection(this.prisma, tx);

    try {
      const created = await db.order.create({
        data: {
          id: randomUUID(),
          userId: normalized.userId,
          status: normalized.status,
          customerPhone: normalized.customerPhone,
          regionId: normalized.regionId,
          regionName: normalized.regionName,
          subtotal: normalized.subtotal,
          total: normalized.total,
          ...(normalized.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: normalized.idempotencyKey }),
          lines: {
            create: normalized.lines.map((line) => ({
              id: randomUUID(),
              productId: line.productId,
              productName: line.productName,
              unitPrice: line.unitPrice,
              quantity: line.quantity,
              lineTotal: line.lineTotal,
            })),
          },
        },
        include: { lines: { orderBy: { createdAt: 'asc' } } },
      });
      return mapOrder(created);
    } catch (error: unknown) {
      throwTranslatedCreateError(error);
      throw error;
    }
  }
}

interface NormalizedCreateOrderLine {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: bigint;
}

interface NormalizedCreateOrderInput {
  userId: string;
  status: typeof OrderStatus.PENDING_REVIEW;
  customerPhone: string;
  regionId: string;
  regionName: string;
  subtotal: bigint;
  total: bigint;
  idempotencyKey?: string;
  lines: NormalizedCreateOrderLine[];
}

function normalizeCreateOrderInput(
  input: CreateOrderInput,
): NormalizedCreateOrderInput {
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new OrderInvalidInputError('Order must have at least one line.');
  }

  const userId = assertOrderUuid(input.userId, 'userId');
  const regionId = assertOrderUuid(input.regionId, 'regionId');
  const customerPhone = normalizeCustomerPhoneSnapshot(input.customerPhone);
  const regionName = normalizeRegionNameSnapshot(input.regionName);
  const idempotencyKey = assertOptionalIdempotencyKey(input.idempotencyKey);

  const lines = collapseAndNormalizeLines(input.lines);
  const lineTotals = lines.map((line) => line.lineTotal);
  const subtotal = sumOrderLineTotals(lineTotals);

  return {
    userId,
    status: OrderStatus.PENDING_REVIEW,
    customerPhone,
    regionId,
    regionName,
    subtotal,
    total: subtotal,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    lines,
  };
}

/**
 * V1 collapses duplicate productId lines before persistence (matches Inventory).
 */
function collapseAndNormalizeLines(
  lines: CreateOrderLineInput[],
): NormalizedCreateOrderLine[] {
  const byProduct = new Map<string, NormalizedCreateOrderLine>();

  for (const line of lines) {
    const productId = assertOrderUuid(line.productId, 'productId');
    const productName = normalizeOrderLineProductName(line.productName);
    const unitPrice = line.unitPrice;
    const quantity = assertPositiveQuantity(line.quantity, 'quantity');
    const lineTotal = computeLineTotal(unitPrice, quantity);

    const existing = byProduct.get(productId);
    if (existing === undefined) {
      byProduct.set(productId, {
        productId,
        productName,
        unitPrice,
        quantity,
        lineTotal,
      });
      continue;
    }

    if (
      existing.unitPrice !== unitPrice ||
      existing.productName !== productName
    ) {
      throw new OrderInvalidLineError(
        'Duplicate product lines must share the same unit price and product name snapshot.',
      );
    }

    const mergedQuantity = existing.quantity + quantity;
    assertPositiveQuantity(mergedQuantity, 'quantity');
    byProduct.set(productId, {
      productId,
      productName,
      unitPrice,
      quantity: mergedQuantity,
      lineTotal: computeLineTotal(unitPrice, mergedQuantity),
    });
  }

  return [...byProduct.values()].sort((left, right) =>
    left.productId.localeCompare(right.productId),
  );
}

function mapOrder(row: PrismaOrderWithLines): OrderRecord {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status as OrderRecord['status'],
    customerPhone: row.customerPhone,
    regionId: row.regionId,
    regionName: row.regionName,
    subtotal: row.subtotal,
    total: row.total,
    idempotencyKey: row.idempotencyKey,
    deliveryAt: row.deliveryAt,
    confirmedAt: row.confirmedAt,
    shippedAt: row.shippedAt,
    deliveredAt: row.deliveredAt,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lines: row.lines.map(mapOrderLine),
  };
}

function mapOrderLine(
  row: PrismaOrderWithLines['lines'][number],
): OrderLineRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    productId: row.productId,
    productName: row.productName,
    unitPrice: row.unitPrice,
    quantity: row.quantity,
    lineTotal: row.lineTotal,
    createdAt: row.createdAt,
  };
}

function throwTranslatedCreateError(error: unknown): void {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2003'
  ) {
    const fieldMeta = error.meta?.field_name;
    const field =
      typeof fieldMeta === 'string'
        ? fieldMeta
        : typeof fieldMeta === 'number' || typeof fieldMeta === 'boolean'
          ? String(fieldMeta)
          : '';
    if (field.includes('userId')) {
      throw new OrderInvalidUserError('User does not exist for this order.');
    }
    if (field.includes('regionId')) {
      throw new OrderInvalidRegionError(
        'Region does not exist for this order.',
      );
    }
    if (field.includes('productId')) {
      throw new OrderInvalidProductError(
        'Product does not exist for this order line.',
      );
    }
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    const target = error.meta?.target;
    const fields = Array.isArray(target)
      ? target.map(String)
      : typeof target === 'string'
        ? [target]
        : [];
    if (
      fields.some((field) => field.includes('userId')) &&
      fields.some((field) => field.includes('idempotencyKey'))
    ) {
      throw new OrderIdempotencyConflictError();
    }
  }
}

function buildTransitionSql(
  orderId: string,
  spec: ClosedOrderTransition,
): Prisma.Sql {
  const ownerPredicate =
    spec.kind === 'pending_to_cancelled' && spec.userId !== undefined
      ? Prisma.sql`AND "userId" = ${spec.userId}::uuid`
      : Prisma.sql``;

  switch (spec.kind) {
    case 'pending_to_confirmed': {
      const applyDelivery = spec.deliveryAt !== undefined;
      const deliveryAt = spec.deliveryAt ?? null;
      return Prisma.sql`
        UPDATE "Order"
        SET
          "status" = ${OrderStatus.CONFIRMED}::"OrderStatus",
          "confirmedAt" = COALESCE("confirmedAt", now()),
          "deliveryAt" = CASE
            WHEN ${applyDelivery}::boolean THEN COALESCE("deliveryAt", ${deliveryAt}::timestamptz)
            ELSE "deliveryAt"
          END,
          "updatedAt" = now()
        WHERE "id" = ${orderId}::uuid
          AND "status" = ${OrderStatus.PENDING_REVIEW}::"OrderStatus"
        RETURNING "id"
      `;
    }
    case 'pending_to_cancelled':
      return Prisma.sql`
        UPDATE "Order"
        SET
          "status" = ${OrderStatus.CANCELLED}::"OrderStatus",
          "cancelledAt" = COALESCE("cancelledAt", now()),
          "cancelReason" = COALESCE("cancelReason", ${spec.cancelReason}),
          "updatedAt" = now()
        WHERE "id" = ${orderId}::uuid
          AND "status" = ${OrderStatus.PENDING_REVIEW}::"OrderStatus"
          ${ownerPredicate}
        RETURNING "id"
      `;
    case 'confirmed_to_cancelled':
      return Prisma.sql`
        UPDATE "Order"
        SET
          "status" = ${OrderStatus.CANCELLED}::"OrderStatus",
          "cancelledAt" = COALESCE("cancelledAt", now()),
          "cancelReason" = COALESCE("cancelReason", ${spec.cancelReason}),
          "updatedAt" = now()
        WHERE "id" = ${orderId}::uuid
          AND "status" = ${OrderStatus.CONFIRMED}::"OrderStatus"
        RETURNING "id"
      `;
    case 'confirmed_to_shipped':
      return Prisma.sql`
        UPDATE "Order"
        SET
          "status" = ${OrderStatus.SHIPPED}::"OrderStatus",
          "shippedAt" = COALESCE("shippedAt", now()),
          "updatedAt" = now()
        WHERE "id" = ${orderId}::uuid
          AND "status" = ${OrderStatus.CONFIRMED}::"OrderStatus"
        RETURNING "id"
      `;
    case 'shipped_to_delivered':
      return Prisma.sql`
        UPDATE "Order"
        SET
          "status" = ${OrderStatus.DELIVERED}::"OrderStatus",
          "deliveredAt" = COALESCE("deliveredAt", now()),
          "updatedAt" = now()
        WHERE "id" = ${orderId}::uuid
          AND "status" = ${OrderStatus.SHIPPED}::"OrderStatus"
        RETURNING "id"
      `;
    default: {
      const exhaustive: never = spec;
      throw new Error('Unsupported order transition: ' + String(exhaustive));
    }
  }
}

/** Exported for unit tests of line collapse behavior. */
export function collapseOrderLinesForTest(
  lines: CreateOrderLineInput[],
): NormalizedCreateOrderLine[] {
  return collapseAndNormalizeLines(lines);
}

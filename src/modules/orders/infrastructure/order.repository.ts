import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { toSkipTake, type PageResult } from '../../../common/list';
import { Prisma } from '../../../generated/prisma/client';
import {
  resolvePrismaConnection,
  type PrismaConnection,
} from '../../../infrastructure/database/prisma/prisma-transaction-context';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import type { AppliedDiscountSnapshot } from '../../pricing/domain/discount-calculation';
import { DiscountTarget, DiscountType } from '../../pricing/domain/discount';
import { normalizeOrderLineProductName } from '../domain/order-line-name';
import { assertTrustedCreateOrderMoney } from '../domain/order-money-invariants';
import {
  OrderInvalidInputError,
  OrderInvalidProductError,
  OrderInvalidRegionError,
  OrderInvalidUserError,
} from '../domain/order-errors';
import { OrderMessage } from '../domain/order-messages';
import {
  assertOrderUuid,
  normalizeCustomerPhoneSnapshot,
  normalizeRegionNameSnapshot,
} from '../domain/order-snapshot';
import { OrderStatus } from '../domain/order-status';
import type {
  OrderLineRecord,
  OrderRecord,
  TrustedCreateOrderInput,
} from '../domain/order';
import type {
  CustomerOrderSortField,
  OrderListQuery,
  OrderListRecord,
} from '../domain/order-list';

/** Advisory lock class for ORD-03 create idempotency (distinct from Inventory). */
const ORDER_CREATE_IDEMPOTENCY_LOCK_CLASS = 120_400;

type PrismaOrderWithLines = {
  id: string;
  userId: string;
  status: string;
  customerPhone: string;
  regionId: string;
  regionName: string;
  grossSubtotal: bigint;
  lineDiscountTotal: bigint;
  subtotalAfterLineDiscounts: bigint;
  orderDiscountAmount: bigint;
  total: bigint;
  pricingEvaluatedAt: Date;
  commercePolicyRevision: number | null;
  appliedOrderDiscountId: string | null;
  appliedOrderDiscountName: string | null;
  appliedOrderDiscountType: string | null;
  appliedOrderDiscountPercentValue: number | null;
  appliedOrderDiscountFixedAmount: number | null;
  appliedOrderDiscountPrecedence: number | null;
  idempotencyKey: string | null;
  idempotencyPayloadHash: string | null;
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
    discountedQuantity: number;
    grossLineTotal: bigint;
    lineDiscountAmount: bigint;
    finalLineTotal: bigint;
    appliedLineDiscountId: string | null;
    appliedLineDiscountName: string | null;
    appliedLineDiscountType: string | null;
    appliedLineDiscountTarget: string | null;
    appliedLineDiscountPercentValue: number | null;
    appliedLineDiscountFixedAmount: number | null;
    appliedLineDiscountPrecedence: number | null;
    appliedLineDiscountProductId: string | null;
    appliedLineDiscountCategoryId: string | null;
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
 * Create accepts trusted server-built snapshots only (ORD-03).
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
      include: {
        lines: { orderBy: [{ productId: 'asc' }, { createdAt: 'asc' }] },
      },
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
      include: {
        lines: { orderBy: [{ productId: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    return found === null ? null : mapOrder(found);
  }

  /**
   * Owner-scoped paginated list for customer reads (ORD-04).
   * Filters and sorts are validated before this boundary; userId is always
   * applied in the query — never fetch-then-filter.
   */
  async listOwned(
    userId: string,
    query: OrderListQuery,
  ): Promise<PageResult<OrderListRecord>> {
    const ownerId = assertOrderUuid(userId, 'userId');
    const where = buildOwnedListWhere(ownerId, query);
    const { skip, take } = toSkipTake(query);
    const orderBy = buildOwnedListOrderBy(query.sortBy, query.sortOrder);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy,
        skip,
        take,
        select: {
          id: true,
          status: true,
          regionId: true,
          regionName: true,
          total: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      items: rows.map(mapOrderListRecord),
      total,
    };
  }

  async findByUserIdAndIdempotencyKey(
    userId: string,
    idempotencyKey: string,
    tx?: TransactionContext,
  ): Promise<OrderRecord | null> {
    const found = await this.db(tx).order.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: assertOrderUuid(userId, 'userId'),
          idempotencyKey: assertOrderUuid(idempotencyKey, 'idempotencyKey'),
        },
      },
      include: {
        lines: { orderBy: [{ productId: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    return found === null ? null : mapOrder(found);
  }

  /**
   * Transaction-scoped advisory lock for (userId, idempotencyKey) create races.
   * Taken before pricing/create/reserve so unique violations are not the
   * primary concurrency control after Inventory side effects.
   */
  async lockCreateIdempotencyScope(
    userId: string,
    idempotencyKey: string,
    tx: TransactionContext,
  ): Promise<void> {
    const user = assertOrderUuid(userId, 'userId');
    const key = assertOrderUuid(idempotencyKey, 'idempotencyKey');
    const lockIdentity = user + ':' + key;
    // $executeRaw: pg_advisory_xact_lock returns void; $queryRaw cannot
    // deserialize void columns under Prisma's PostgreSQL driver.
    await this.db(tx).$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(
        ${ORDER_CREATE_IDEMPOTENCY_LOCK_CLASS},
        hashtext(${lockIdentity})
      )
    `);
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
   * Persist trusted PRC-05 snapshots + customer/region snapshots.
   * Does not accept client money/name/discount fields as authority.
   */
  async createWithTrustedSnapshots(
    input: TrustedCreateOrderInput,
    tx?: TransactionContext,
  ): Promise<OrderRecord> {
    const normalized = normalizeTrustedCreateInput(input);
    const db = resolvePrismaConnection(this.prisma, tx);

    try {
      const created = await db.order.create({
        data: {
          id: randomUUID(),
          userId: normalized.userId,
          status: OrderStatus.PENDING_REVIEW,
          customerPhone: normalized.customerPhone,
          regionId: normalized.regionId,
          regionName: normalized.regionName,
          grossSubtotal: normalized.grossSubtotal,
          lineDiscountTotal: normalized.lineDiscountTotal,
          subtotalAfterLineDiscounts: normalized.subtotalAfterLineDiscounts,
          orderDiscountAmount: normalized.orderDiscountAmount,
          total: normalized.total,
          pricingEvaluatedAt: normalized.pricingEvaluatedAt,
          commercePolicyRevision: normalized.commercePolicyRevision,
          ...mapOrderDiscountColumns(normalized.appliedOrderDiscount),
          idempotencyKey: normalized.idempotencyKey,
          idempotencyPayloadHash: normalized.idempotencyPayloadHash,
          lines: {
            create: normalized.lines.map((line) => ({
              id: randomUUID(),
              productId: line.productId,
              productName: line.productName,
              unitPrice: line.unitPrice,
              quantity: line.quantity,
              discountedQuantity: line.discountedQuantity,
              grossLineTotal: line.grossLineTotal,
              lineDiscountAmount: line.lineDiscountAmount,
              finalLineTotal: line.finalLineTotal,
              ...mapLineDiscountColumns(line.appliedLineDiscount),
            })),
          },
        },
        include: {
          lines: { orderBy: [{ productId: 'asc' }, { createdAt: 'asc' }] },
        },
      });
      return mapOrder(created);
    } catch (error: unknown) {
      throwTranslatedCreateError(error);
      throw error;
    }
  }
}

function normalizeTrustedCreateInput(
  input: TrustedCreateOrderInput,
): TrustedCreateOrderInput {
  assertTrustedCreateOrderMoney(input);

  const userId = assertOrderUuid(input.userId, 'userId');
  const regionId = assertOrderUuid(input.regionId, 'regionId');
  const idempotencyKey = assertOrderUuid(
    input.idempotencyKey,
    'idempotencyKey',
  );
  const customerPhone = normalizeCustomerPhoneSnapshot(input.customerPhone);
  const regionName = normalizeRegionNameSnapshot(input.regionName);

  if (
    typeof input.idempotencyPayloadHash !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(input.idempotencyPayloadHash)
  ) {
    throw new OrderInvalidInputError(
      'idempotencyPayloadHash must be a 64-character lowercase hex SHA-256.',
    );
  }

  const seen = new Set<string>();
  const lines = [...input.lines]
    .map((line) => {
      const productId = assertOrderUuid(line.productId, 'productId');
      if (seen.has(productId)) {
        throw new OrderInvalidInputError(
          'Trusted order lines must already be collapsed by productId.',
        );
      }
      seen.add(productId);
      return {
        ...line,
        productId,
        productName: normalizeOrderLineProductName(line.productName),
      };
    })
    .sort((left, right) => left.productId.localeCompare(right.productId));

  return {
    ...input,
    userId,
    regionId,
    customerPhone,
    regionName,
    idempotencyKey,
    lines,
  };
}

function mapOrderDiscountColumns(applied: AppliedDiscountSnapshot | null): {
  appliedOrderDiscountId: string | null;
  appliedOrderDiscountName: string | null;
  appliedOrderDiscountType: DiscountType | null;
  appliedOrderDiscountPercentValue: number | null;
  appliedOrderDiscountFixedAmount: number | null;
  appliedOrderDiscountPrecedence: number | null;
} {
  if (applied === null) {
    return {
      appliedOrderDiscountId: null,
      appliedOrderDiscountName: null,
      appliedOrderDiscountType: null,
      appliedOrderDiscountPercentValue: null,
      appliedOrderDiscountFixedAmount: null,
      appliedOrderDiscountPrecedence: null,
    };
  }
  return {
    appliedOrderDiscountId: applied.discountId,
    appliedOrderDiscountName: applied.name,
    appliedOrderDiscountType: applied.type,
    appliedOrderDiscountPercentValue: applied.percentValue,
    appliedOrderDiscountFixedAmount: applied.fixedAmount,
    appliedOrderDiscountPrecedence: applied.precedence,
  };
}

function mapLineDiscountColumns(applied: AppliedDiscountSnapshot | null): {
  appliedLineDiscountId: string | null;
  appliedLineDiscountName: string | null;
  appliedLineDiscountType: DiscountType | null;
  appliedLineDiscountTarget: DiscountTarget | null;
  appliedLineDiscountPercentValue: number | null;
  appliedLineDiscountFixedAmount: number | null;
  appliedLineDiscountPrecedence: number | null;
  appliedLineDiscountProductId: string | null;
  appliedLineDiscountCategoryId: string | null;
} {
  if (applied === null) {
    return {
      appliedLineDiscountId: null,
      appliedLineDiscountName: null,
      appliedLineDiscountType: null,
      appliedLineDiscountTarget: null,
      appliedLineDiscountPercentValue: null,
      appliedLineDiscountFixedAmount: null,
      appliedLineDiscountPrecedence: null,
      appliedLineDiscountProductId: null,
      appliedLineDiscountCategoryId: null,
    };
  }
  return {
    appliedLineDiscountId: applied.discountId,
    appliedLineDiscountName: applied.name,
    appliedLineDiscountType: applied.type,
    appliedLineDiscountTarget: applied.target,
    appliedLineDiscountPercentValue: applied.percentValue,
    appliedLineDiscountFixedAmount: applied.fixedAmount,
    appliedLineDiscountPrecedence: applied.precedence,
    appliedLineDiscountProductId: applied.productId,
    appliedLineDiscountCategoryId: applied.categoryId,
  };
}

function mapOrder(row: PrismaOrderWithLines): OrderRecord {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status as OrderRecord['status'],
    customerPhone: row.customerPhone,
    regionId: row.regionId,
    regionName: row.regionName,
    grossSubtotal: row.grossSubtotal,
    lineDiscountTotal: row.lineDiscountTotal,
    subtotalAfterLineDiscounts: row.subtotalAfterLineDiscounts,
    orderDiscountAmount: row.orderDiscountAmount,
    total: row.total,
    pricingEvaluatedAt: row.pricingEvaluatedAt,
    commercePolicyRevision: row.commercePolicyRevision,
    appliedOrderDiscount: mapAppliedOrderDiscount(row),
    idempotencyKey: row.idempotencyKey,
    idempotencyPayloadHash: row.idempotencyPayloadHash,
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
    discountedQuantity: row.discountedQuantity,
    grossLineTotal: row.grossLineTotal,
    lineDiscountAmount: row.lineDiscountAmount,
    finalLineTotal: row.finalLineTotal,
    appliedLineDiscount: mapAppliedLineDiscount(row),
    createdAt: row.createdAt,
  };
}

function mapAppliedOrderDiscount(
  row: PrismaOrderWithLines,
): AppliedDiscountSnapshot | null {
  if (row.appliedOrderDiscountId === null) {
    return null;
  }
  return {
    discountId: row.appliedOrderDiscountId,
    name: row.appliedOrderDiscountName!,
    type: row.appliedOrderDiscountType as DiscountType,
    target: DiscountTarget.ORDER,
    percentValue: row.appliedOrderDiscountPercentValue,
    fixedAmount: row.appliedOrderDiscountFixedAmount,
    precedence: row.appliedOrderDiscountPrecedence!,
    productId: null,
    categoryId: null,
  };
}

function mapAppliedLineDiscount(
  row: PrismaOrderWithLines['lines'][number],
): AppliedDiscountSnapshot | null {
  if (row.appliedLineDiscountId === null) {
    return null;
  }
  return {
    discountId: row.appliedLineDiscountId,
    name: row.appliedLineDiscountName!,
    type: row.appliedLineDiscountType as DiscountType,
    target: row.appliedLineDiscountTarget as DiscountTarget,
    percentValue: row.appliedLineDiscountPercentValue,
    fixedAmount: row.appliedLineDiscountFixedAmount,
    precedence: row.appliedLineDiscountPrecedence!,
    productId: row.appliedLineDiscountProductId,
    categoryId: row.appliedLineDiscountCategoryId,
  };
}

function throwTranslatedCreateError(error: unknown): void {
  if (!isPrismaKnownRequestError(error)) {
    return;
  }

  if (error.code === 'P2003') {
    const fieldMeta = error.meta?.['field_name'];
    const field =
      typeof fieldMeta === 'string'
        ? fieldMeta
        : typeof fieldMeta === 'number' || typeof fieldMeta === 'boolean'
          ? String(fieldMeta)
          : '';
    if (field.includes('userId')) {
      throw new OrderInvalidUserError(OrderMessage.INVALID_USER);
    }
    if (field.includes('regionId')) {
      throw new OrderInvalidRegionError(OrderMessage.INVALID_REGION);
    }
    if (field.includes('productId')) {
      throw new OrderInvalidProductError(OrderMessage.PRODUCT_UNAVAILABLE);
    }
  }
}

function isPrismaKnownRequestError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return true;
  }
  // Driver / duplicate @prisma/client copies can break instanceof.
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'PrismaClientKnownRequestError' &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  );
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

type OrderListRow = {
  id: string;
  status: string;
  regionId: string;
  regionName: string;
  total: bigint;
  createdAt: Date;
};

const SORT_FIELD_MAP: Record<
  CustomerOrderSortField,
  keyof Pick<OrderListRow, 'createdAt' | 'total' | 'status'>
> = {
  createdAt: 'createdAt',
  total: 'total',
  status: 'status',
};

function buildOwnedListWhere(
  userId: string,
  query: OrderListQuery,
): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = { userId };
  if (query.status !== undefined) {
    where.status = query.status;
  }
  if (query.createdFrom !== undefined || query.createdTo !== undefined) {
    where.createdAt = {
      ...(query.createdFrom === undefined ? {} : { gte: query.createdFrom }),
      ...(query.createdTo === undefined ? {} : { lte: query.createdTo }),
    };
  }
  return where;
}

function buildOwnedListOrderBy(
  sortBy: CustomerOrderSortField,
  sortOrder: 'asc' | 'desc',
): Prisma.OrderOrderByWithRelationInput[] {
  const field = SORT_FIELD_MAP[sortBy];
  return [{ [field]: sortOrder }, { id: 'asc' }];
}

function mapOrderListRecord(row: OrderListRow): OrderListRecord {
  return {
    id: row.id,
    status: row.status as OrderListRecord['status'],
    regionId: row.regionId,
    regionName: row.regionName,
    total: row.total,
    createdAt: row.createdAt,
  };
}

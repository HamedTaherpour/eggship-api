import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { ApplicationError } from '../../../common/errors/application-error';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { TransactionRunner } from '../../../infrastructure/database/transaction';
import { CommercePolicyService } from '../../commerce-policy/application/commerce-policy.service';
import { InventoryService } from '../../inventory/application/inventory.service';
import { InventoryLedgerActorType } from '../../inventory/domain/inventory-ledger';
import { DiscountUsageService } from '../../pricing/application/discount-usage.service';
import { OrderPricingService } from '../../pricing/application/order-pricing.service';
import {
  OrderPricingInvalidInputError,
  OrderPricingInvalidLineError,
  OrderPricingInvalidMoneyError,
  OrderPricingProductUnavailableError,
} from '../../pricing/domain/order-pricing-errors';
import { normalizeOrderPricingLineInputs } from '../../pricing/domain/order-pricing';
import type { OrderPricingSnapshot } from '../../pricing/domain/order-pricing';
import { RegionRepository } from '../../regions/infrastructure/region.repository';
import { UserRepository } from '../../users/infrastructure/user.repository';
import { assertUserActor } from '../domain/order-actor';
import { hashOrderCreatePayload } from '../domain/order-create-idempotency';
import {
  OrderIdempotencyConflictError,
  OrderInvalidInputError,
  OrderInvalidMoneyError,
  OrderInvalidProductError,
  OrderInvalidRegionError,
  OrderInvalidUserError,
} from '../domain/order-errors';
import { OrderMessage } from '../domain/order-messages';
import type { OrderRecord, TrustedCreateOrderInput } from '../domain/order';
import { assertOrderUuid } from '../domain/order-snapshot';
import { OrderRepository } from '../infrastructure/order.repository';
import type {
  CreateOrderCommand,
  CreateOrderResult,
} from './order-creation.commands';

/** Bounded retries when RR + Inventory row updates hit SQLSTATE 40001 / P2034. */
const CREATE_SERIALIZATION_MAX_ATTEMPTS = 5;

/**
 * ORD-03 / COM-03 / DLU-02 transactional order creation.
 * One REPEATABLE READ transaction: policy → price (+ usage locks) → persist
 * snapshots → CONSUME usage → reserve Inventory.
 * No HTTP. Callers supply trusted USER actor + region + lines + idempotency key.
 *
 * ORD-03A owns joining User/Region reads to this outer transaction before HTTP.
 */
@Injectable()
export class OrderCreationService {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly orders: OrderRepository,
    private readonly commercePolicy: CommercePolicyService,
    private readonly pricing: OrderPricingService,
    private readonly discountUsage: DiscountUsageService,
    private readonly inventory: InventoryService,
    private readonly users: UserRepository,
    private readonly regions: RegionRepository,
    private readonly logger: ApplicationLogger,
  ) {}

  async createOrder(input: CreateOrderCommand): Promise<CreateOrderResult> {
    const actor = assertUserActor(input.actor);
    const userId = actor.id;
    const regionId = assertOrderUuid(input.regionId, 'regionId');
    const idempotencyKey = assertOrderUuid(
      input.idempotencyKey,
      'idempotencyKey',
    );

    let normalizedLines;
    try {
      normalizedLines = normalizeOrderPricingLineInputs(input.lines);
    } catch (error: unknown) {
      throw this.mapPricingInputError(error);
    }

    const payloadHash = hashOrderCreatePayload({
      regionId,
      lines: normalizedLines,
    });

    let lastError: unknown;
    for (
      let attempt = 1;
      attempt <= CREATE_SERIALIZATION_MAX_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const result = await this.createOnce({
          userId,
          regionId,
          idempotencyKey,
          payloadHash,
          normalizedLines,
        });
        if (result.created) {
          this.logger.info(
            {
              module: 'orders',
              operation: 'order.created',
              orderId: result.order.id,
              userId,
              lineCount: result.order.lines.length,
            },
            'Order created with inventory reservation',
          );
        }
        return result;
      } catch (error: unknown) {
        lastError = error;

        // REPEATABLE READ takes its snapshot at the first statement. A waiter
        // blocked on pg_advisory_xact_lock can therefore miss the winner's
        // committed Order row and hit the unique index. Recover only when a
        // fresh read outside the rolled-back transaction proves that exact
        // idempotency row committed. Otherwise preserve the original failure.
        if (
          error instanceof OrderIdempotencyConflictError ||
          isUniqueConstraintFailure(error)
        ) {
          let existing: OrderRecord | null;
          try {
            existing = await this.orders.findByUserIdAndIdempotencyKey(
              userId,
              idempotencyKey,
            );
          } catch {
            throw error;
          }
          if (existing !== null) {
            return this.replayOrConflict(existing, payloadHash);
          }
          throw error;
        }

        if (
          isSerializationFailure(error) &&
          attempt < CREATE_SERIALIZATION_MAX_ATTEMPTS
        ) {
          this.logger.info(
            {
              module: 'orders',
              operation: 'order.create.serialization_retry',
              attempt,
            },
            'Retrying order create after serialization failure',
          );
          continue;
        }
        throw this.mapCreateError(error);
      }
    }

    throw this.mapCreateError(lastError);
  }

  private async createOnce(input: {
    userId: string;
    regionId: string;
    idempotencyKey: string;
    payloadHash: string;
    normalizedLines: Array<{ productId: string; quantity: number }>;
  }): Promise<CreateOrderResult> {
    return this.transactions.runRepeatableRead(async (tx) => {
      await this.orders.lockCreateIdempotencyScope(
        input.userId,
        input.idempotencyKey,
        tx,
      );

      const existing = await this.orders.findByUserIdAndIdempotencyKey(
        input.userId,
        input.idempotencyKey,
        tx,
      );
      if (existing !== null) {
        return this.replayOrConflict(existing, input.payloadHash);
      }

      // COM-03: one coherent policy snapshot + DB evaluation instant.
      // Rejects before User/Region/pricing/persist/reserve. No policy row locks.
      const acceptance = await this.commercePolicy.evaluateOrderAcceptance(
        input.normalizedLines,
        tx,
      );

      // ORD-03A: User/Region reads must join this outer transaction before HTTP.
      const user = await this.users.findById(input.userId);
      if (user === null || !user.isActive) {
        throw new OrderInvalidUserError(OrderMessage.INVALID_USER);
      }

      const region = await this.regions.findById(input.regionId);
      if (region === null || !region.isActive) {
        throw new OrderInvalidRegionError(OrderMessage.INVALID_REGION);
      }

      // DLU-02: priceOrderLines locks DiscountCustomerUsage (sorted discountId)
      // before composition when userId is supplied.
      const priced = await this.pricing.priceOrderLines(input.normalizedLines, {
        tx,
        evaluatedAt: acceptance.evaluatedAt,
        userId: input.userId,
      });

      const createInput = this.toTrustedCreateInput({
        userId: input.userId,
        customerPhone: user.phone,
        regionId: region.id,
        regionName: region.name,
        idempotencyKey: input.idempotencyKey,
        payloadHash: input.payloadHash,
        commercePolicyRevision: acceptance.revision,
        evaluatedAt: acceptance.evaluatedAt,
        priced,
      });

      // Do not re-read inside this transaction after a unique violation:
      // PostgreSQL aborts the tx (25P02) and further commands fail with P2039.
      // Outer createOrder recovers via a fresh read / retry after rollback.
      const created = await this.orders.createWithTrustedSnapshots(
        createInput,
        tx,
      );

      await this.discountUsage.consumeForOrder(
        {
          orderId: created.id,
          userId: input.userId,
          consumptions: priced.lifetimeConsumptions,
        },
        tx,
      );

      await this.inventory.reserveForOrder(
        {
          orderId: created.id,
          lines: input.normalizedLines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
          })),
          actor: {
            type: InventoryLedgerActorType.USER,
            id: input.userId,
          },
        },
        tx,
      );

      return { order: created, created: true };
    });
  }

  private replayOrConflict(
    existing: OrderRecord,
    payloadHash: string,
  ): CreateOrderResult {
    if (
      existing.idempotencyPayloadHash === null ||
      existing.idempotencyPayloadHash !== payloadHash
    ) {
      throw new OrderIdempotencyConflictError(
        OrderMessage.IDEMPOTENCY_CONFLICT,
      );
    }
    return { order: existing, created: false };
  }

  private toTrustedCreateInput(input: {
    userId: string;
    customerPhone: string;
    regionId: string;
    regionName: string;
    idempotencyKey: string;
    payloadHash: string;
    commercePolicyRevision: number;
    evaluatedAt: Date;
    priced: OrderPricingSnapshot;
  }): TrustedCreateOrderInput {
    return {
      userId: input.userId,
      customerPhone: input.customerPhone,
      regionId: input.regionId,
      regionName: input.regionName,
      idempotencyKey: input.idempotencyKey,
      idempotencyPayloadHash: input.payloadHash,
      pricingEvaluatedAt: input.evaluatedAt,
      commercePolicyRevision: input.commercePolicyRevision,
      grossSubtotal: input.priced.grossSubtotal,
      lineDiscountTotal: input.priced.lineDiscountTotal,
      subtotalAfterLineDiscounts: input.priced.subtotalAfterLineDiscounts,
      orderDiscountAmount: input.priced.orderDiscountAmount,
      total: input.priced.total,
      appliedOrderDiscount: input.priced.appliedOrderDiscount,
      lines: input.priced.lines.map((line) => ({
        productId: line.productId,
        productName: line.productName,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        discountedQuantity: line.discountedQuantity,
        grossLineTotal: line.grossLineTotal,
        lineDiscountAmount: line.lineDiscountAmount,
        finalLineTotal: line.finalLineTotal,
        appliedLineDiscount: line.appliedLineDiscount,
      })),
    };
  }

  private mapPricingInputError(error: unknown): Error {
    if (
      error instanceof OrderPricingInvalidInputError ||
      error instanceof OrderPricingInvalidLineError ||
      error instanceof OrderPricingInvalidMoneyError
    ) {
      return new OrderInvalidInputError(OrderMessage.INVALID_INPUT);
    }
    if (error instanceof Error) {
      return error;
    }
    return new OrderInvalidInputError(OrderMessage.INVALID_INPUT);
  }

  private mapCreateError(error: unknown): Error {
    if (error instanceof OrderPricingProductUnavailableError) {
      return new OrderInvalidProductError(OrderMessage.PRODUCT_UNAVAILABLE);
    }
    if (
      error instanceof OrderPricingInvalidInputError ||
      error instanceof OrderPricingInvalidLineError ||
      error instanceof OrderPricingInvalidMoneyError
    ) {
      return new OrderInvalidInputError(OrderMessage.INVALID_INPUT);
    }
    if (error instanceof OrderInvalidMoneyError) {
      return new OrderInvalidMoneyError(OrderMessage.INVALID_INPUT);
    }
    if (isSerializationFailure(error)) {
      return new OrderInvalidInputError(OrderMessage.CREATE_CONFLICT);
    }
    if (error instanceof ApplicationError) {
      return error;
    }
    if (error instanceof Error) {
      return error;
    }
    return new OrderInvalidInputError(OrderMessage.INVALID_INPUT);
  }
}

function isSerializationFailure(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  ) {
    return true;
  }
  return hasStructuredDatabaseCode(error, 'P2034', '40001');
}

function isUniqueConstraintFailure(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    return true;
  }
  return hasStructuredDatabaseCode(error, 'P2002', '23505');
}

function hasStructuredDatabaseCode(
  error: unknown,
  prismaCode: string,
  postgresCode: string,
): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const record = error as {
    code?: unknown;
    cause?: { code?: unknown; originalCode?: unknown };
    meta?: {
      code?: unknown;
      driverAdapterError?: {
        cause?: { code?: unknown; originalCode?: unknown };
      };
    };
  };
  const supportedCodes = new Set([prismaCode, postgresCode]);
  return (
    isSupportedDatabaseCode(record.code, supportedCodes) ||
    isSupportedDatabaseCode(record.cause?.code, supportedCodes) ||
    isSupportedDatabaseCode(record.cause?.originalCode, supportedCodes) ||
    isSupportedDatabaseCode(record.meta?.code, supportedCodes) ||
    isSupportedDatabaseCode(
      record.meta?.driverAdapterError?.cause?.code,
      supportedCodes,
    ) ||
    isSupportedDatabaseCode(
      record.meta?.driverAdapterError?.cause?.originalCode,
      supportedCodes,
    )
  );
}

function isSupportedDatabaseCode(
  value: unknown,
  supportedCodes: ReadonlySet<string>,
): boolean {
  return typeof value === 'string' && supportedCodes.has(value);
}

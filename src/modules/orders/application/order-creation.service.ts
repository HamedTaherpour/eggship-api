import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { ApplicationError } from '../../../common/errors/application-error';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { TransactionRunner } from '../../../infrastructure/database/transaction';
import { InventoryService } from '../../inventory/application/inventory.service';
import { InventoryLedgerActorType } from '../../inventory/domain/inventory-ledger';
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

/**
 * Bounded retries when RR + Inventory row updates hit SQLSTATE 40001 / P2034,
 * or when an advisory-lock waiter inherits a pre-lock RR snapshot and misses
 * the winner's committed idempotency row (unique / conflict → fresh tx).
 */
const CREATE_SERIALIZATION_MAX_ATTEMPTS = 5;

/**
 * ORD-03 transactional order creation.
 * One REPEATABLE READ transaction: price → persist snapshots → reserve.
 * No HTTP. Callers supply trusted USER actor + region + lines + idempotency key.
 */
@Injectable()
export class OrderCreationService {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly orders: OrderRepository,
    private readonly pricing: OrderPricingService,
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
        return await this.createOnce({
          userId,
          regionId,
          idempotencyKey,
          payloadHash,
          normalizedLines,
        });
      } catch (error: unknown) {
        lastError = error;

        // REPEATABLE READ takes its snapshot at the first statement. A waiter
        // blocked on pg_advisory_xact_lock can therefore miss the winner's
        // committed Order row and hit the unique index. Recover with a fresh
        // read outside the aborted transaction, or retry createOnce so a new
        // RR snapshot is taken after the lock wait completes.
        if (
          error instanceof OrderIdempotencyConflictError ||
          isUniqueConstraintFailure(error)
        ) {
          const existing = await this.orders.findByUserIdAndIdempotencyKey(
            userId,
            idempotencyKey,
          );
          if (existing !== null) {
            return this.replayOrConflict(existing, payloadHash);
          }
          if (attempt < CREATE_SERIALIZATION_MAX_ATTEMPTS) {
            this.logger.info(
              {
                module: 'orders',
                operation: 'order.create.idempotency_retry',
                attempt,
              },
              'Retrying order create after idempotency unique miss under RR',
            );
            continue;
          }
          if (error instanceof OrderIdempotencyConflictError) {
            throw error;
          }
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

      const user = await this.users.findById(input.userId);
      if (user === null || !user.isActive) {
        throw new OrderInvalidUserError(OrderMessage.INVALID_USER);
      }

      const region = await this.regions.findById(input.regionId);
      if (region === null || !region.isActive) {
        throw new OrderInvalidRegionError(OrderMessage.INVALID_REGION);
      }

      const priced = await this.pricing.priceOrderLines(input.normalizedLines, {
        tx,
      });

      const createInput = this.toTrustedCreateInput({
        userId: input.userId,
        customerPhone: user.phone,
        regionId: region.id,
        regionName: region.name,
        idempotencyKey: input.idempotencyKey,
        payloadHash: input.payloadHash,
        priced,
      });

      // Do not re-read inside this transaction after a unique violation:
      // PostgreSQL aborts the tx (25P02) and further commands fail with P2039.
      // Outer createOrder recovers via a fresh read / retry after rollback.
      const created = await this.orders.createWithTrustedSnapshots(
        createInput,
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

      this.logger.info(
        {
          module: 'orders',
          operation: 'order.created',
          orderId: created.id,
          userId: input.userId,
          lineCount: created.lines.length,
        },
        'Order created with inventory reservation',
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
    priced: OrderPricingSnapshot;
  }): TrustedCreateOrderInput {
    return {
      userId: input.userId,
      customerPhone: input.customerPhone,
      regionId: input.regionId,
      regionName: input.regionName,
      idempotencyKey: input.idempotencyKey,
      idempotencyPayloadHash: input.payloadHash,
      pricingEvaluatedAt: input.priced.evaluatedAt,
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
    if (isUniqueConstraintFailure(error)) {
      return new OrderIdempotencyConflictError(
        OrderMessage.IDEMPOTENCY_CONFLICT,
      );
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
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('could not serialize access') ||
      message.includes('serialization failure') ||
      message.includes('40001')
    );
  }
  return false;
}

function isUniqueConstraintFailure(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    return true;
  }
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const record = error as {
    code?: unknown;
    message?: unknown;
    meta?: { driverAdapterError?: { cause?: { code?: unknown } } };
  };
  if (record.code === '23505' || record.code === 'P2002') {
    return true;
  }
  if (record.meta?.driverAdapterError?.cause?.code === '23505') {
    return true;
  }
  if (typeof record.message === 'string') {
    return /unique constraint|23505|p2002/i.test(record.message);
  }
  return false;
}

import { Injectable } from '@nestjs/common';
import { RequestContextService } from '../../../common/observability/request-context.service';
import { TransactionRunner } from '../../../infrastructure/database/transaction';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import {
  inspectAvailability,
  type AvailabilityInspection,
} from '../domain/availability-inspection';
import type { InventoryBalance } from '../domain/inventory-balance';
import {
  InventoryLedgerActorType,
  InventoryLedgerReferenceType,
  InventoryLedgerType,
  assertLedgerActor,
  expectedDeltasForType,
  type InventoryActor,
  type InventoryLedgerEntry,
} from '../domain/inventory-ledger';
import {
  InventoryInsufficientStockError,
  InventoryInvalidQuantityError,
  InventoryNotFoundError,
  InventoryReservationConflictError,
  InventoryReservationNotFoundError,
} from '../domain/inventory-errors';
import { InventoryHttpMessage } from '../domain/inventory-http-messages';
import {
  InventoryReservationStatus,
  type InventoryReservation,
} from '../domain/inventory-reservation';
import {
  assertAdjustmentDelta,
  assertInventoryUuid,
  assertPositiveQuantity,
  isInventoryUuid,
} from '../domain/inventory-quantity';
import { normalizeProductIdsForLock } from '../domain/lock-product-ids';
import {
  classifyReleaseAgainstExisting,
  classifyReserveAgainstExisting,
  OrderReleasePlan,
  OrderReservePlan,
  reservationProductIdsMatch,
} from '../domain/order-reservation-state';
import {
  collapseReservationLines,
  shortageDetailsWithoutAvailability,
  type NormalizedReservationLine,
} from '../domain/reservation-lines';
import type {
  AdjustOnHandInput,
  BalanceMutationResult,
  CompleteReservationInput,
  LockAndInspectInput,
  OnHandIncreaseInput,
  OrderReservationResult,
  ReleaseForOrderInput,
  ReservationMutationResult,
  ReserveForOrderInput,
  WriteOffOnHandInput,
} from './inventory-commands';
import { InventoryBalanceRepository } from '../infrastructure/inventory-balance.repository';
import { InventoryLedgerRepository } from '../infrastructure/inventory-ledger.repository';
import { InventoryReservationRepository } from '../infrastructure/inventory-reservation.repository';

const SYSTEM_ACTOR: InventoryActor = {
  type: InventoryLedgerActorType.SYSTEM,
  id: null,
};

/**
 * Inventory application contracts (INV-01B primitives + INV-03 order reserve/release).
 * Quantity mutation and ledger append always share one PostgreSQL transaction.
 * Orders must call these methods; they must not mutate Inventory tables.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly balances: InventoryBalanceRepository,
    private readonly reservations: InventoryReservationRepository,
    private readonly ledger: InventoryLedgerRepository,
    private readonly requestContext: RequestContextService,
  ) {}

  async ensureForProduct(
    productId: string,
    tx?: TransactionContext,
  ): Promise<InventoryBalance> {
    return this.transactions.runIn(tx, (ctx) =>
      this.balances.ensureForProduct(productId, ctx),
    );
  }

  async getBalance(
    productId: string,
    tx?: TransactionContext,
  ): Promise<InventoryBalance | null> {
    return this.balances.findByProductId(productId, tx);
  }

  async lockBalances(
    productIds: readonly string[],
    tx: TransactionContext,
  ): Promise<InventoryBalance[]> {
    return this.balances.lockBalances(productIds, tx);
  }

  /**
   * Lock rows, then report every shortage without writing.
   */
  async lockAndInspectAvailability(input: LockAndInspectInput): Promise<{
    balances: InventoryBalance[];
    inspection: AvailabilityInspection;
  }> {
    const collapsed = this.normalizeLines(input.items);
    const productIds = collapsed.map((item) => item.productId);
    const balances = await this.balances.lockBalances(productIds, input.tx);
    const inspection = inspectAvailability({
      requested: collapsed,
      locked: balances.map((row) => ({
        productId: row.productId,
        available: row.available,
      })),
    });
    return { balances, inspection };
  }

  async reserveForOrder(
    input: ReserveForOrderInput,
    tx?: TransactionContext,
  ): Promise<OrderReservationResult> {
    const orderId = this.requireOrderId(input.orderId);
    const lines = this.normalizeLines(input.lines);
    const actor = assertLedgerActor(input.actor);
    const correlationId = this.resolveLedgerCorrelationId(input.correlationId);

    return this.transactions.runIn(tx, async (ctx) => {
      await this.reservations.lockOrderScope(orderId, ctx);
      const productIds = lines.map((line) => line.productId);
      const balances = await this.balances.lockBalances(productIds, ctx);
      const inspection = inspectAvailability({
        requested: lines,
        locked: balances.map((row) => ({
          productId: row.productId,
          available: row.available,
        })),
      });
      const existing = await this.reservations.lockByOrderId(orderId, ctx);
      const plan = classifyReserveAgainstExisting(lines, existing);

      if (plan === OrderReservePlan.REPLAY) {
        return this.toOrderReservationResult(orderId, existing);
      }
      if (plan === OrderReservePlan.CONFLICT) {
        throw new InventoryReservationConflictError(
          InventoryHttpMessage.RESERVATION_CONFLICT,
          { orderId },
        );
      }

      this.rejectMissingInventory(inspection.missingProductIds);
      this.rejectShortages(inspection.shortages);

      const committed: InventoryReservation[] = [];
      for (const line of lines) {
        committed.push(
          await this.writeFreshReservationLine({
            orderId,
            line,
            actor,
            correlationId,
            ctx,
          }),
        );
      }
      return this.toOrderReservationResult(orderId, committed);
    });
  }

  async releaseForOrder(
    input: ReleaseForOrderInput,
    tx?: TransactionContext,
  ): Promise<OrderReservationResult> {
    const orderId = this.requireOrderId(input.orderId);
    const actor = assertLedgerActor(input.actor);
    const correlationId = this.resolveLedgerCorrelationId(input.correlationId);

    return this.transactions.runIn(tx, async (ctx) => {
      await this.reservations.lockOrderScope(orderId, ctx);
      const snapshot = await this.reservations.findByOrderId(orderId, ctx);
      if (snapshot.length === 0) {
        throw new InventoryReservationNotFoundError(
          InventoryHttpMessage.RESERVATION_NOT_FOUND,
          { orderId },
        );
      }

      const productIds = normalizeProductIdsForLock(
        snapshot.map((row) => row.productId),
      );
      const locked = await this.balances.lockBalances(productIds, ctx);
      if (locked.length !== productIds.length) {
        throw new InventoryNotFoundError(InventoryHttpMessage.NOT_FOUND, {
          productIds: productIds.filter(
            (id) => !locked.some((row) => row.productId === id),
          ),
        });
      }

      const existing = await this.reservations.lockByOrderId(orderId, ctx);
      if (!reservationProductIdsMatch(productIds, existing)) {
        throw new InventoryReservationConflictError(
          InventoryHttpMessage.RESERVATION_CONFLICT,
          { orderId },
        );
      }

      const plan = classifyReleaseAgainstExisting(existing);
      if (plan === OrderReleasePlan.REPLAY) {
        return this.toOrderReservationResult(orderId, existing);
      }
      if (plan !== OrderReleasePlan.RELEASE) {
        throw new InventoryReservationConflictError(
          InventoryHttpMessage.RESERVATION_CONFLICT,
          { orderId },
        );
      }

      const released: InventoryReservation[] = [];
      for (const row of existing) {
        released.push(
          await this.writeReleaseLine({
            reservation: row,
            actor,
            correlationId,
            ctx,
          }),
        );
      }
      return this.toOrderReservationResult(orderId, released);
    });
  }

  async releaseReservation(
    input: CompleteReservationInput,
    tx?: TransactionContext,
  ): Promise<ReservationMutationResult> {
    return this.completeReservation(
      input,
      InventoryReservationStatus.RELEASED,
      InventoryLedgerType.RELEASE,
      (productId, quantity, ctx) =>
        this.balances.releaseQuantity(productId, quantity, ctx),
      tx,
    );
  }

  async shipReservation(
    input: CompleteReservationInput,
    tx?: TransactionContext,
  ): Promise<ReservationMutationResult> {
    return this.completeReservation(
      input,
      InventoryReservationStatus.SHIPPED,
      InventoryLedgerType.SHIP,
      (productId, quantity, ctx) =>
        this.balances.shipQuantity(productId, quantity, ctx),
      tx,
    );
  }

  async receiveOnHand(
    input: OnHandIncreaseInput,
    tx?: TransactionContext,
  ): Promise<BalanceMutationResult> {
    return this.increaseOnHand(input, InventoryLedgerType.RECEIVE, tx);
  }

  async returnToStock(
    input: OnHandIncreaseInput,
    tx?: TransactionContext,
  ): Promise<BalanceMutationResult> {
    return this.increaseOnHand(input, InventoryLedgerType.RETURN_TO_STOCK, tx);
  }

  async adjustOnHand(
    input: AdjustOnHandInput,
    tx?: TransactionContext,
  ): Promise<BalanceMutationResult> {
    const productId = assertInventoryUuid(input.productId, 'productId');
    const delta = assertAdjustmentDelta(input.delta);
    return this.transactions.runIn(tx, async (ctx) => {
      const balance = await this.balances.adjustOnHand(productId, delta, ctx);
      const quantity = Math.abs(delta);
      const ledger = await this.appendBalanceEvent({
        type: InventoryLedgerType.ADJUST,
        productId,
        quantity,
        balance,
        onHandDelta: delta,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        reason: input.reason,
        actor: input.actor,
        correlationId: input.correlationId,
        ctx,
      });
      return { balance, ledger };
    });
  }

  async writeOffOnHand(
    input: WriteOffOnHandInput,
    tx?: TransactionContext,
  ): Promise<BalanceMutationResult> {
    const productId = assertInventoryUuid(input.productId, 'productId');
    const quantity = assertPositiveQuantity(input.quantity);
    return this.transactions.runIn(tx, async (ctx) => {
      const balance = await this.balances.decrementOnHand(
        productId,
        quantity,
        ctx,
      );
      const ledger = await this.appendBalanceEvent({
        type: InventoryLedgerType.WRITE_OFF,
        productId,
        quantity,
        balance,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        reason: input.reason,
        actor: input.actor,
        correlationId: input.correlationId,
        ctx,
      });
      return { balance, ledger };
    });
  }

  private async increaseOnHand(
    input: OnHandIncreaseInput,
    type:
      | typeof InventoryLedgerType.RECEIVE
      | typeof InventoryLedgerType.RETURN_TO_STOCK,
    tx?: TransactionContext,
  ): Promise<BalanceMutationResult> {
    const productId = assertInventoryUuid(input.productId, 'productId');
    const quantity = assertPositiveQuantity(input.quantity);
    return this.transactions.runIn(tx, async (ctx) => {
      const balance = await this.balances.incrementOnHand(
        productId,
        quantity,
        ctx,
      );
      const ledger = await this.appendBalanceEvent({
        type,
        productId,
        quantity,
        balance,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        reason: input.reason,
        actor: input.actor,
        correlationId: input.correlationId,
        ctx,
      });
      return { balance, ledger };
    });
  }

  private async completeReservation(
    input: CompleteReservationInput,
    to:
      | typeof InventoryReservationStatus.RELEASED
      | typeof InventoryReservationStatus.SHIPPED,
    ledgerType:
      typeof InventoryLedgerType.RELEASE | typeof InventoryLedgerType.SHIP,
    mutate: (
      productId: string,
      quantity: number,
      ctx: TransactionContext,
    ) => Promise<InventoryBalance>,
    tx?: TransactionContext,
  ): Promise<ReservationMutationResult> {
    const orderId = assertInventoryUuid(input.orderId, 'orderId');
    const productId = assertInventoryUuid(input.productId, 'productId');

    return this.transactions.runIn(tx, async (ctx) => {
      await this.reservations.lockOrderScope(orderId, ctx);
      await this.requireLockedBalance(productId, ctx);
      const existing = await this.reservations.findByOrderProduct(
        orderId,
        productId,
        ctx,
      );
      if (existing === null) {
        throw new InventoryReservationNotFoundError(
          'Inventory reservation was not found.',
          { orderId, productId },
        );
      }

      const outcome = await this.reservations.transitionFromActive(
        existing.id,
        to,
        ctx,
      );
      if (outcome === null) {
        throw new InventoryReservationNotFoundError(
          'Inventory reservation was not found.',
          { orderId, productId },
        );
      }

      if (!outcome.transitioned) {
        if (outcome.reservation.status === to) {
          return this.resumeExistingReservation(
            outcome.reservation,
            ledgerType,
            ctx,
          );
        }
        throw new InventoryReservationConflictError(
          'This inventory reservation cannot be changed.',
          {
            orderId,
            productId,
            status: outcome.reservation.status,
          },
        );
      }

      const balance = await mutate(productId, existing.quantity, ctx);
      const ledger = await this.appendBalanceEvent({
        type: ledgerType,
        productId,
        quantity: existing.quantity,
        balance,
        referenceType: InventoryLedgerReferenceType.ORDER,
        referenceId: orderId,
        actor: input.actor,
        correlationId: input.correlationId,
        ctx,
      });
      return { balance, reservation: outcome.reservation, ledger };
    });
  }

  private async writeFreshReservationLine(input: {
    orderId: string;
    line: NormalizedReservationLine;
    actor: InventoryActor;
    correlationId: string | null;
    ctx: TransactionContext;
  }): Promise<InventoryReservation> {
    const inserted = await this.reservations.insertActive(
      {
        orderId: input.orderId,
        productId: input.line.productId,
        quantity: input.line.quantity,
      },
      input.ctx,
    );
    if (!inserted.inserted) {
      // Classify already required FRESH under the order advisory lock.
      // A matching row here is an inconsistency — fail closed, do not increment.
      throw new InventoryReservationConflictError(
        InventoryHttpMessage.RESERVATION_CONFLICT,
        {
          orderId: input.orderId,
          productId: input.line.productId,
        },
      );
    }

    const balance = await this.balances.reserveQuantity(
      input.line.productId,
      input.line.quantity,
      input.ctx,
    );
    await this.appendBalanceEvent({
      type: InventoryLedgerType.RESERVE,
      productId: input.line.productId,
      quantity: input.line.quantity,
      balance,
      referenceType: InventoryLedgerReferenceType.ORDER,
      referenceId: input.orderId,
      actor: input.actor,
      correlationId: input.correlationId,
      ctx: input.ctx,
    });
    return inserted.reservation;
  }

  private async writeReleaseLine(input: {
    reservation: InventoryReservation;
    actor: InventoryActor;
    correlationId: string | null;
    ctx: TransactionContext;
  }): Promise<InventoryReservation> {
    const outcome = await this.reservations.transitionFromActive(
      input.reservation.id,
      InventoryReservationStatus.RELEASED,
      input.ctx,
    );
    if (outcome === null || !outcome.transitioned) {
      throw new InventoryReservationConflictError(
        InventoryHttpMessage.RESERVATION_CONFLICT,
        {
          orderId: input.reservation.orderId,
          productId: input.reservation.productId,
        },
      );
    }

    const balance = await this.balances.releaseQuantity(
      input.reservation.productId,
      input.reservation.quantity,
      input.ctx,
    );
    await this.appendBalanceEvent({
      type: InventoryLedgerType.RELEASE,
      productId: input.reservation.productId,
      quantity: input.reservation.quantity,
      balance,
      referenceType: InventoryLedgerReferenceType.ORDER,
      referenceId: input.reservation.orderId,
      actor: input.actor,
      correlationId: input.correlationId,
      ctx: input.ctx,
    });
    return outcome.reservation;
  }

  private async resumeExistingReservation(
    reservation: InventoryReservation,
    ledgerType:
      | typeof InventoryLedgerType.RESERVE
      | typeof InventoryLedgerType.RELEASE
      | typeof InventoryLedgerType.SHIP,
    ctx: TransactionContext,
  ): Promise<ReservationMutationResult> {
    const balance = await this.requireBalance(reservation.productId, ctx);
    const ledger = await this.ledger.findOrderEvent(
      ledgerType,
      reservation.orderId,
      reservation.productId,
      ctx,
    );
    return { balance, reservation, ledger };
  }

  private async requireLockedBalance(
    productId: string,
    ctx: TransactionContext,
  ): Promise<InventoryBalance> {
    const locked = await this.balances.lockBalances([productId], ctx);
    if (locked.length !== 1) {
      throw new InventoryNotFoundError(
        'Inventory was not found for this product.',
        { productId },
      );
    }
    return locked[0]!;
  }

  private async requireBalance(
    productId: string,
    tx?: TransactionContext,
  ): Promise<InventoryBalance> {
    const balance = await this.balances.findByProductId(productId, tx);
    if (balance === null) {
      throw new InventoryNotFoundError(
        'Inventory was not found for this product.',
        { productId },
      );
    }
    return balance;
  }

  private normalizeLines(
    lines: ReadonlyArray<{ productId: string; quantity: number }>,
  ): NormalizedReservationLine[] {
    try {
      return collapseReservationLines(lines);
    } catch (error: unknown) {
      if (error instanceof InventoryInvalidQuantityError) {
        throw new InventoryInvalidQuantityError(
          InventoryHttpMessage.INVALID_QUANTITY,
        );
      }
      throw error;
    }
  }

  private requireOrderId(orderId: string): string {
    try {
      return assertInventoryUuid(orderId, 'orderId');
    } catch (error: unknown) {
      if (error instanceof InventoryInvalidQuantityError) {
        throw new InventoryInvalidQuantityError(
          InventoryHttpMessage.INVALID_QUANTITY,
        );
      }
      throw error;
    }
  }

  private rejectMissingInventory(missingProductIds: readonly string[]): void {
    if (missingProductIds.length === 0) {
      return;
    }
    throw new InventoryNotFoundError(InventoryHttpMessage.NOT_FOUND, {
      productIds: [...missingProductIds],
    });
  }

  private rejectShortages(
    shortages: ReadonlyArray<{ productId: string; requested: number }>,
  ): void {
    if (shortages.length === 0) {
      return;
    }
    throw new InventoryInsufficientStockError(
      InventoryHttpMessage.INSUFFICIENT_STOCK,
      shortageDetailsWithoutAvailability(shortages),
    );
  }

  private toOrderReservationResult(
    orderId: string,
    rows: readonly InventoryReservation[],
  ): OrderReservationResult {
    return {
      orderId,
      lines: [...rows]
        .sort((left, right) =>
          left.productId < right.productId
            ? -1
            : left.productId > right.productId
              ? 1
              : 0,
        )
        .map((row) => ({
          productId: row.productId,
          quantity: row.quantity,
          status: row.status,
        })),
    };
  }

  /**
   * Ledger.correlationId is UUID. HTTP request ids (`req_...`) are omitted
   * rather than stored or replaced with orderId.
   */
  private resolveLedgerCorrelationId(explicit?: string | null): string | null {
    const candidate =
      explicit ?? this.requestContext.getCorrelationId() ?? null;
    if (candidate === null) {
      return null;
    }
    return isInventoryUuid(candidate) ? candidate.toLowerCase() : null;
  }

  private async appendBalanceEvent(input: {
    type: (typeof InventoryLedgerType)[keyof typeof InventoryLedgerType];
    productId: string;
    quantity: number;
    balance: InventoryBalance;
    onHandDelta?: number;
    referenceType: (typeof InventoryLedgerReferenceType)[keyof typeof InventoryLedgerReferenceType];
    referenceId: string | null;
    reason?: string | null;
    actor: InventoryActor;
    correlationId?: string | null;
    ctx: TransactionContext;
  }): Promise<InventoryLedgerEntry> {
    const deltas = expectedDeltasForType(
      input.type,
      input.quantity,
      input.onHandDelta,
    );
    return this.ledger.append(
      {
        productId: input.productId,
        type: input.type,
        quantity: input.quantity,
        onHandDelta: deltas.onHandDelta,
        reservedDelta: deltas.reservedDelta,
        onHandAfter: input.balance.onHand,
        reservedAfter: input.balance.reserved,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        reason: input.reason,
        actorType: input.actor.type,
        actorId: input.actor.id,
        correlationId: input.correlationId ?? null,
      },
      input.ctx,
    );
  }
}

export { SYSTEM_ACTOR };

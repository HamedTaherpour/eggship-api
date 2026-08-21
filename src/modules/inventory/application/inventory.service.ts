import { Injectable } from '@nestjs/common';
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
  expectedDeltasForType,
  type InventoryActor,
  type InventoryLedgerEntry,
} from '../domain/inventory-ledger';
import {
  InventoryNotFoundError,
  InventoryReservationConflictError,
  InventoryReservationNotFoundError,
} from '../domain/inventory-errors';
import {
  InventoryReservationStatus,
  type InventoryReservation,
} from '../domain/inventory-reservation';
import {
  assertAdjustmentDelta,
  assertInventoryUuid,
  assertPositiveQuantity,
} from '../domain/inventory-quantity';
import { normalizeProductIdsForLock } from '../domain/lock-product-ids';
import type {
  AdjustOnHandInput,
  BalanceMutationResult,
  CompleteReservationInput,
  LockAndInspectInput,
  OnHandIncreaseInput,
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
 * Inventory persistence primitives (INV-01B). Not HTTP use cases.
 * Quantity mutation and ledger append always share one PostgreSQL transaction.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly balances: InventoryBalanceRepository,
    private readonly reservations: InventoryReservationRepository,
    private readonly ledger: InventoryLedgerRepository,
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
   * Lock rows, then report every shortage without writing. INV-03 will use this
   * for all-or-nothing multi-SKU reservation.
   */
  async lockAndInspectAvailability(input: LockAndInspectInput): Promise<{
    balances: InventoryBalance[];
    inspection: AvailabilityInspection;
  }> {
    const requested = input.items.map((item) => ({
      productId: assertInventoryUuid(item.productId, 'productId'),
      quantity: assertPositiveQuantity(item.quantity),
    }));
    const quantityByProduct = new Map<string, number>();
    for (const item of requested) {
      quantityByProduct.set(
        item.productId,
        (quantityByProduct.get(item.productId) ?? 0) + item.quantity,
      );
    }
    const collapsed = [...quantityByProduct.entries()].map(
      ([productId, quantity]) => ({ productId, quantity }),
    );
    const productIds = normalizeProductIdsForLock(
      collapsed.map((item) => item.productId),
    );
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
  ): Promise<ReservationMutationResult> {
    const orderId = assertInventoryUuid(input.orderId, 'orderId');
    const productId = assertInventoryUuid(input.productId, 'productId');
    const quantity = assertPositiveQuantity(input.quantity);

    return this.transactions.runIn(tx, async (ctx) => {
      await this.requireLockedBalance(productId, ctx);
      const inserted = await this.reservations.insertActive(
        { orderId, productId, quantity },
        ctx,
      );
      if (!inserted.inserted) {
        return this.resumeExistingReservation(
          inserted.reservation,
          InventoryLedgerType.RESERVE,
          ctx,
        );
      }
      const balance = await this.balances.reserveQuantity(
        productId,
        quantity,
        ctx,
      );
      const ledger = await this.appendBalanceEvent({
        type: InventoryLedgerType.RESERVE,
        productId,
        quantity,
        balance,
        referenceType: InventoryLedgerReferenceType.ORDER,
        referenceId: orderId,
        actor: input.actor,
        correlationId: input.correlationId,
        ctx,
      });
      return {
        balance,
        reservation: inserted.reservation,
        ledger,
      };
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

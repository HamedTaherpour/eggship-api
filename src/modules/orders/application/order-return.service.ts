import { Injectable } from '@nestjs/common';
import { TransactionRunner } from '../../../infrastructure/database/transaction';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import { InventoryService } from '../../inventory/application/inventory.service';
import {
  InventoryLedgerActorType,
  InventoryLedgerReferenceType,
} from '../../inventory/domain/inventory-ledger';
import { assertAdminActor } from '../domain/order-actor';
import {
  OrderIdempotencyConflictError,
  OrderInvalidInputError,
  OrderInvalidTransitionError,
  OrderNotFoundError,
  OrderReturnQuantityExceededError,
} from '../domain/order-errors';
import {
  assertOrderReturnInput,
  hashOrderReturnPayload,
  normalizeOrderReturnReason,
} from '../domain/order-return';
import { assertOrderUuid } from '../domain/order-snapshot';
import { OrderStatus } from '../domain/order-status';
import { OrderRepository } from '../infrastructure/order.repository';
import { OrderReturnRepository } from '../infrastructure/order-return.repository';
import type {
  RecordOrderReturnCommand,
  RecordOrderReturnResult,
} from './order-return.commands';

/** ORD-07 operation A. The Orders module owns the cross-domain transaction. */
@Injectable()
export class OrderReturnService {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly orders: OrderRepository,
    private readonly returns: OrderReturnRepository,
    private readonly inventory: InventoryService,
  ) {}

  async recordReturn(
    input: RecordOrderReturnCommand,
    tx?: TransactionContext,
  ): Promise<RecordOrderReturnResult> {
    const orderId = assertOrderUuid(input.orderId, 'orderId');
    const idempotencyKey = assertOrderUuid(
      input.idempotencyKey,
      'idempotencyKey',
    );
    const actor = assertAdminActor(input.actor);
    const reason = normalizeOrderReturnReason(input.reason);
    assertOrderReturnInput({
      orderId,
      recordedByAdminId: actor.id,
      reason,
      idempotencyKey,
      idempotencyPayloadHash: '0'.repeat(64),
      lines: input.lines,
    });
    const payloadHash = hashOrderReturnPayload({
      orderId,
      reason,
      lines: input.lines,
    });

    return this.transactions.runIn(tx, async (ctx) => {
      await this.returns.lockIdempotencyScope(idempotencyKey, ctx);
      const existing = await this.returns.lockByIdempotencyKey(
        idempotencyKey,
        ctx,
      );
      if (existing !== null) {
        if (existing.idempotencyPayloadHash !== payloadHash) {
          throw new OrderIdempotencyConflictError();
        }
        return { orderReturn: existing, replay: true };
      }

      if (!(await this.orders.lockByIdForReturn(orderId, ctx))) {
        throw new OrderNotFoundError();
      }
      const order = await this.orders.findById(orderId, ctx);
      if (order === null) throw new OrderNotFoundError();
      if (order.status !== OrderStatus.DELIVERED) {
        throw new OrderInvalidTransitionError();
      }

      const linesById = new Map(order.lines.map((line) => [line.id, line]));
      const restocks: Array<{ productId: string; quantity: number }> = [];
      for (const line of input.lines) {
        const source = linesById.get(line.orderLineId);
        if (source === undefined) {
          throw new OrderInvalidInputError(
            'Return line does not belong to this order.',
          );
        }
        const prior = await this.returns.sumReturnedQuantityByOrderLine(
          line.orderLineId,
          ctx,
        );
        const requested = line.sellableQuantity + line.damagedQuantity;
        if (prior + requested > source.quantity) {
          throw new OrderReturnQuantityExceededError();
        }
        if (line.sellableQuantity > 0) {
          restocks.push({
            productId: source.productId,
            quantity: line.sellableQuantity,
          });
        }
      }

      const created = await this.returns.createWithLines(
        {
          orderId,
          recordedByAdminId: actor.id,
          reason,
          idempotencyKey,
          idempotencyPayloadHash: payloadHash,
          lines: input.lines,
        },
        ctx,
      );

      const sorted = [...restocks].sort((left, right) =>
        left.productId.localeCompare(right.productId),
      );
      if (sorted.length > 0) {
        await this.inventory.lockBalances(
          sorted.map((row) => row.productId),
          ctx,
        );
        for (const row of sorted) {
          await this.inventory.returnToStock(
            {
              productId: row.productId,
              quantity: row.quantity,
              referenceType: InventoryLedgerReferenceType.RETURN,
              referenceId: created.id,
              reason,
              actor: { type: InventoryLedgerActorType.ADMIN, id: actor.id },
            },
            ctx,
          );
        }
      }
      return { orderReturn: created, replay: false };
    });
  }
}

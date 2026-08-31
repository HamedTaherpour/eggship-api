import { Injectable, Optional } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { TransactionRunner } from '../../../infrastructure/database/transaction';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import { AuditLogService } from '../../audit/application/audit-log.service';
import {
  AuditAction,
  AuditEntityType,
  type AuditEvent,
} from '../../audit/domain/audit-event';
import { InventoryService } from '../../inventory/application/inventory.service';
import {
  InventoryReservationConflictError,
  InventoryReservationNotFoundError,
} from '../../inventory/domain/inventory-errors';
import {
  InventoryLedgerActorType,
  type InventoryActor,
} from '../../inventory/domain/inventory-ledger';
import { DiscountUsageService } from '../../pricing/application/discount-usage.service';
import {
  assertAdminActor,
  assertUserActor,
  OrderActorType,
  type OrderActor,
  type OrderAdminActor,
  type OrderUserActor,
} from '../domain/order-actor';
import { normalizeAdminCancelReason } from '../domain/order-cancellation-reason';
import { parseOptionalDeliveryAt } from '../domain/order-delivery-at';
import {
  OrderInvalidTransitionError,
  OrderNotFoundError,
} from '../domain/order-errors';
import { assertLifecycleTimestamps } from '../domain/order-lifecycle';
import { OrderMessage } from '../domain/order-messages';
import type { OrderRecord } from '../domain/order';
import { OrderStatus } from '../domain/order-status';
import { assertOrderUuid } from '../domain/order-snapshot';
import {
  classifyZeroRowUpdate,
  ZeroRowClassification,
} from '../domain/order-transitions';
import { OrderRepository } from '../infrastructure/order.repository';
import { OrderStatusNotificationService } from '../../notifications/application/order-status-notification.service';
import type { OrderStatusNotificationInput } from '../../notifications/application/order-status-notification.service';
import type {
  CancelOrderByAdminCommand,
  CancelPendingOrderByCustomerCommand,
  ConfirmOrderCommand,
  DeliverOrderCommand,
  OrderTransitionResult,
  ShipOrderCommand,
} from './order-transition.commands';

/**
 * Orders-owned transition orchestration (ORD-02 / DLU-02). No HTTP.
 * Discount usage release and Inventory join the same opaque TransactionContext
 * after the Order conditional UPDATE wins — never the reverse lock order.
 */
@Injectable()
export class OrderTransitionService {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly orders: OrderRepository,
    private readonly discountUsage: DiscountUsageService,
    private readonly inventory: InventoryService,
    private readonly logger: ApplicationLogger,
    private readonly orderStatusNotifications: OrderStatusNotificationService,
    @Optional() private readonly audit?: AuditLogService,
  ) {}

  async confirmOrder(
    input: ConfirmOrderCommand,
    tx?: TransactionContext,
  ): Promise<OrderTransitionResult> {
    const orderId = this.requireOrderId(input.orderId);
    const actor = assertAdminActor(input.actor);
    const deliveryAt = parseOptionalDeliveryAt(input.deliveryAt);

    return this.transactions.runIn(tx, async (ctx) => {
      const won = await this.orders.transitionPendingToConfirmed(
        orderId,
        deliveryAt === undefined ? {} : { deliveryAt },
        ctx,
      );
      if (won === null) {
        return this.classifyUnscopedZeroRow({
          orderId,
          target: OrderStatus.CONFIRMED,
          actor,
          operation: 'order.confirmed',
          ctx,
        });
      }
      await this.orderStatusNotifications.generate(notificationInput(won), ctx);
      return this.succeeded(
        won,
        actor,
        'order.confirmed',
        OrderStatus.PENDING_REVIEW,
        ctx,
      );
    });
  }

  async cancelPendingOrderByCustomer(
    input: CancelPendingOrderByCustomerCommand,
    tx?: TransactionContext,
  ): Promise<OrderTransitionResult> {
    const orderId = this.requireOrderId(input.orderId);
    const actor = assertUserActor(input.actor);

    return this.transactions.runIn(tx, async (ctx) => {
      const won = await this.orders.transitionPendingToCancelledForOwner(
        orderId,
        actor.id,
        ctx,
      );
      if (won === null) {
        return this.classifyOwnedZeroRow({
          orderId,
          userId: actor.id,
          target: OrderStatus.CANCELLED,
          actor,
          operation: 'order.cancelled',
          invalidMessage: OrderMessage.CUSTOMER_CANCEL_DENIED,
          ctx,
        });
      }

      await this.releaseDiscountUsage(orderId, actor.id, ctx);
      await this.releaseInventoryForCustomer(orderId, actor, ctx);
      await this.orderStatusNotifications.generate(notificationInput(won), ctx);
      return this.succeeded(
        won,
        actor,
        'order.cancelled',
        OrderStatus.PENDING_REVIEW,
        ctx,
      );
    });
  }

  async cancelOrderByAdmin(
    input: CancelOrderByAdminCommand,
    tx?: TransactionContext,
  ): Promise<OrderTransitionResult> {
    const orderId = this.requireOrderId(input.orderId);
    const actor = assertAdminActor(input.actor);
    const cancelReason = normalizeAdminCancelReason(input.cancelReason);

    return this.transactions.runIn(tx, async (ctx) => {
      const current = await this.orders.findById(orderId, ctx);
      if (current === null) {
        throw new OrderNotFoundError();
      }
      if (current.status === OrderStatus.CANCELLED) {
        return this.replay(current, actor, 'order.cancelled');
      }
      if (current.status === OrderStatus.PENDING_REVIEW) {
        return this.cancelFromPendingByAdmin(orderId, actor, cancelReason, ctx);
      }
      if (current.status === OrderStatus.CONFIRMED) {
        return this.cancelFromConfirmedByAdmin(
          orderId,
          actor,
          cancelReason,
          ctx,
        );
      }
      this.logRejected({
        orderId,
        actor,
        operation: 'order.cancelled',
        fromStatus: current.status,
        toStatus: OrderStatus.CANCELLED,
      });
      throw new OrderInvalidTransitionError();
    });
  }

  async shipOrder(
    input: ShipOrderCommand,
    tx?: TransactionContext,
  ): Promise<OrderTransitionResult> {
    const orderId = this.requireOrderId(input.orderId);
    const actor = assertAdminActor(input.actor);

    return this.transactions.runIn(tx, async (ctx) => {
      const won = await this.orders.transitionConfirmedToShipped(orderId, ctx);
      if (won === null) {
        return this.classifyUnscopedZeroRow({
          orderId,
          target: OrderStatus.SHIPPED,
          actor,
          operation: 'order.shipped',
          ctx,
        });
      }

      await this.inventory.shipForOrder(
        { orderId, actor: toInventoryActor(actor) },
        ctx,
      );
      await this.orderStatusNotifications.generate(notificationInput(won), ctx);
      return this.succeeded(
        won,
        actor,
        'order.shipped',
        OrderStatus.CONFIRMED,
        ctx,
      );
    });
  }

  async deliverOrder(
    input: DeliverOrderCommand,
    tx?: TransactionContext,
  ): Promise<OrderTransitionResult> {
    const orderId = this.requireOrderId(input.orderId);
    const actor = assertAdminActor(input.actor);

    return this.transactions.runIn(tx, async (ctx) => {
      const won = await this.orders.transitionShippedToDelivered(orderId, ctx);
      if (won === null) {
        return this.classifyUnscopedZeroRow({
          orderId,
          target: OrderStatus.DELIVERED,
          actor,
          operation: 'order.delivered',
          ctx,
        });
      }
      await this.orderStatusNotifications.generate(notificationInput(won), ctx);
      return this.succeeded(
        won,
        actor,
        'order.delivered',
        OrderStatus.SHIPPED,
        ctx,
      );
    });
  }

  private async cancelFromPendingByAdmin(
    orderId: string,
    actor: OrderAdminActor,
    cancelReason: string,
    ctx: TransactionContext,
  ): Promise<OrderTransitionResult> {
    const won = await this.orders.transitionPendingToCancelled(
      orderId,
      { cancelReason },
      ctx,
    );
    if (won === null) {
      return this.classifyUnscopedZeroRow({
        orderId,
        target: OrderStatus.CANCELLED,
        actor,
        operation: 'order.cancelled',
        ctx,
      });
    }
    await this.releaseDiscountUsage(orderId, won.userId, ctx);
    await this.inventory.releaseForOrder(
      { orderId, actor: toInventoryActor(actor) },
      ctx,
    );
    await this.orderStatusNotifications.generate(notificationInput(won), ctx);
    return this.succeeded(
      won,
      actor,
      'order.cancelled',
      OrderStatus.PENDING_REVIEW,
      ctx,
    );
  }

  private async cancelFromConfirmedByAdmin(
    orderId: string,
    actor: OrderAdminActor,
    cancelReason: string,
    ctx: TransactionContext,
  ): Promise<OrderTransitionResult> {
    const won = await this.orders.transitionConfirmedToCancelled(
      orderId,
      { cancelReason },
      ctx,
    );
    if (won === null) {
      return this.classifyUnscopedZeroRow({
        orderId,
        target: OrderStatus.CANCELLED,
        actor,
        operation: 'order.cancelled',
        ctx,
      });
    }
    await this.releaseDiscountUsage(orderId, won.userId, ctx);
    await this.inventory.releaseForOrder(
      { orderId, actor: toInventoryActor(actor) },
      ctx,
    );
    await this.orderStatusNotifications.generate(notificationInput(won), ctx);
    return this.succeeded(
      won,
      actor,
      'order.cancelled',
      OrderStatus.CONFIRMED,
      ctx,
    );
  }

  private async releaseDiscountUsage(
    orderId: string,
    userId: string,
    ctx: TransactionContext,
  ): Promise<void> {
    await this.discountUsage.releaseForOrder({ orderId, userId }, ctx);
  }

  private async releaseInventoryForCustomer(
    orderId: string,
    actor: OrderUserActor,
    ctx: TransactionContext,
  ): Promise<void> {
    try {
      await this.inventory.releaseForOrder(
        { orderId, actor: toInventoryActor(actor) },
        ctx,
      );
    } catch (error: unknown) {
      if (
        error instanceof InventoryReservationNotFoundError ||
        error instanceof InventoryReservationConflictError
      ) {
        this.logger.warn(
          {
            module: 'orders',
            operation: 'order.transition.rejected',
            orderId,
            actorType: actor.type,
            fromStatus: OrderStatus.PENDING_REVIEW,
            toStatus: OrderStatus.CANCELLED,
            errorCode: error.code,
          },
          'Customer cancel mapped an inventory consistency failure',
        );
        throw new OrderInvalidTransitionError(
          OrderMessage.CUSTOMER_CANCEL_DENIED,
        );
      }
      if (error instanceof ApplicationError) {
        this.logger.error(
          {
            module: 'orders',
            operation: 'order.transition.rejected',
            orderId,
            actorType: actor.type,
            fromStatus: OrderStatus.PENDING_REVIEW,
            toStatus: OrderStatus.CANCELLED,
            errorCode: error.code,
          },
          'Customer cancel hid an inventory application error',
          error,
        );
        throw new Error(
          'Customer order cancellation could not complete inventory release.',
          { cause: error },
        );
      }
      throw error;
    }
  }

  private async classifyUnscopedZeroRow(input: {
    orderId: string;
    target: OrderStatus;
    actor: OrderActor;
    operation: string;
    ctx: TransactionContext;
  }): Promise<OrderTransitionResult> {
    const current = await this.orders.findById(input.orderId, input.ctx);
    return this.classifyLoadedZeroRow({
      ...input,
      current,
      invalidMessage: OrderMessage.INVALID_TRANSITION,
    });
  }

  private async classifyOwnedZeroRow(input: {
    orderId: string;
    userId: string;
    target: OrderStatus;
    actor: OrderUserActor;
    operation: string;
    invalidMessage: string;
    ctx: TransactionContext;
  }): Promise<OrderTransitionResult> {
    const current = await this.orders.findOwnedById(
      input.orderId,
      input.userId,
      input.ctx,
    );
    return this.classifyLoadedZeroRow({
      orderId: input.orderId,
      target: input.target,
      actor: input.actor,
      operation: input.operation,
      current,
      invalidMessage: input.invalidMessage,
    });
  }

  private classifyLoadedZeroRow(input: {
    orderId: string;
    target: OrderStatus;
    actor: OrderActor;
    operation: string;
    current: OrderRecord | null;
    invalidMessage: string;
  }): OrderTransitionResult {
    const classification = classifyZeroRowUpdate(
      input.current?.status ?? null,
      input.target,
    );
    if (classification === ZeroRowClassification.MISSING) {
      throw new OrderNotFoundError();
    }
    if (
      classification === ZeroRowClassification.REPLAY &&
      input.current !== null
    ) {
      return this.replay(input.current, input.actor, input.operation);
    }
    this.logRejected({
      orderId: input.orderId,
      actor: input.actor,
      operation: input.operation,
      fromStatus: input.current?.status,
      toStatus: input.target,
    });
    throw new OrderInvalidTransitionError(input.invalidMessage);
  }

  private async succeeded(
    order: OrderRecord,
    actor: OrderActor,
    operation: string,
    fromStatus: OrderStatus,
    ctx: TransactionContext,
  ): Promise<OrderTransitionResult> {
    assertLifecycleTimestamps(order);
    const actionByOperation: Record<string, AuditAction> = {
      'order.cancelled': AuditAction.ORDER_CANCELLED,
      'order.confirmed': AuditAction.ORDER_CONFIRMED,
      'order.shipped': AuditAction.ORDER_SHIPPED,
      'order.delivered': AuditAction.ORDER_DELIVERED,
    };
    await this.audit?.append(
      {
        action: actionByOperation[operation]!,
        actorType: actor.type,
        actorId: actor.id,
        entityType: AuditEntityType.ORDER,
        entityId: order.id,
        metadata: undefined,
      } as AuditEvent,
      ctx,
    );
    this.logger.info(
      {
        module: 'orders',
        operation,
        orderId: order.id,
        fromStatus,
        toStatus: order.status,
        actorType: actor.type,
        replay: false,
      },
      'Order transition succeeded',
    );
    return { order, replay: false };
  }

  private replay(
    order: OrderRecord,
    actor: OrderActor,
    operation: string,
  ): OrderTransitionResult {
    assertLifecycleTimestamps(order);
    this.logger.info(
      {
        module: 'orders',
        operation,
        orderId: order.id,
        fromStatus: order.status,
        toStatus: order.status,
        actorType: actor.type,
        replay: true,
      },
      'Order transition replayed',
    );
    return { order, replay: true };
  }

  private logRejected(input: {
    orderId: string;
    actor: OrderActor;
    operation: string;
    fromStatus: OrderStatus | undefined;
    toStatus: OrderStatus;
  }): void {
    this.logger.info(
      {
        module: 'orders',
        operation: 'order.transition.rejected',
        orderId: input.orderId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        actorType: input.actor.type,
        attemptedOperation: input.operation,
      },
      'Order transition rejected',
    );
  }

  private requireOrderId(orderId: string): string {
    return assertOrderUuid(orderId, 'orderId');
  }
}

function toInventoryActor(actor: OrderActor): InventoryActor {
  if (actor.type === OrderActorType.USER) {
    return { type: InventoryLedgerActorType.USER, id: actor.id };
  }
  return { type: InventoryLedgerActorType.ADMIN, id: actor.id };
}

function notificationInput(order: OrderRecord): OrderStatusNotificationInput {
  const occurredAt =
    order.status === OrderStatus.CONFIRMED
      ? order.confirmedAt
      : order.status === OrderStatus.SHIPPED
        ? order.shippedAt
        : order.status === OrderStatus.DELIVERED
          ? order.deliveredAt
          : order.cancelledAt;
  if (occurredAt === null) {
    throw new Error(
      'Order notification transition is missing its lifecycle timestamp.',
    );
  }
  return {
    orderId: order.id,
    userId: order.userId,
    status: order.status,
    occurredAt,
  };
}

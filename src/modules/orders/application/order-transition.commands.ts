import type { OrderAdminActor, OrderUserActor } from '../domain/order-actor';
import type { OrderRecord } from '../domain/order';

export interface OrderTransitionResult {
  order: OrderRecord;
  replay: boolean;
}

export interface ConfirmOrderCommand {
  orderId: string;
  actor: OrderAdminActor;
  deliveryAt?: Date | string;
}

export interface CancelPendingOrderByCustomerCommand {
  orderId: string;
  actor: OrderUserActor;
}

export interface CancelOrderByAdminCommand {
  orderId: string;
  actor: OrderAdminActor;
  cancelReason: string;
}

export interface ShipOrderCommand {
  orderId: string;
  actor: OrderAdminActor;
}

export interface DeliverOrderCommand {
  orderId: string;
  actor: OrderAdminActor;
}

/** Explicit ORD-07 completion command; it does not record a return event. */
export interface CompleteReturnProcessCommand {
  orderId: string;
  actor: OrderAdminActor;
}

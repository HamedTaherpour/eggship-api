import type { OrderUserActor } from '../domain/order-actor';
import type { OrderRecord } from '../domain/order';

/**
 * Application create command (ORD-03). No HTTP DTO.
 * Money, product names, discounts, phone, and actor identity are server-owned.
 */
export interface CreateOrderCommand {
  actor: OrderUserActor;
  regionId: string;
  customerNote?: string | null;
  idempotencyKey: string;
  lines: ReadonlyArray<{
    productId: string;
    quantity: number;
  }>;
}

export interface CreateOrderResult {
  order: OrderRecord;
  /** True when this call created the order; false on idempotent replay. */
  created: boolean;
}

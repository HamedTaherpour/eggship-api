import type { OrderRecord } from './order';
import { OrderStatus } from './order-status';

/**
 * Application lifecycle timestamp invariants (not CHECK constraints).
 * Set on first successful transition only; never cleared; never rewritten on replay.
 */
export function assertLifecycleTimestamps(order: OrderRecord): void {
  switch (order.status) {
    case OrderStatus.CONFIRMED:
      requireTimestamp(order, 'confirmedAt');
      return;
    case OrderStatus.SHIPPED:
      requireTimestamp(order, 'confirmedAt');
      requireTimestamp(order, 'shippedAt');
      return;
    case OrderStatus.DELIVERED:
      requireTimestamp(order, 'confirmedAt');
      requireTimestamp(order, 'shippedAt');
      requireTimestamp(order, 'deliveredAt');
      return;
    case OrderStatus.RETURNED:
      requireTimestamp(order, 'confirmedAt');
      requireTimestamp(order, 'shippedAt');
      requireTimestamp(order, 'deliveredAt');
      requireTimestamp(order, 'returnedAt');
      return;
    case OrderStatus.CANCELLED:
      requireTimestamp(order, 'cancelledAt');
      return;
    case OrderStatus.PENDING_REVIEW:
      return;
    default: {
      const exhaustive: never = order.status;
      throw new Error(`Unsupported order status: ${String(exhaustive)}`);
    }
  }
}

function requireTimestamp(
  order: OrderRecord,
  field:
    'confirmedAt' | 'shippedAt' | 'deliveredAt' | 'returnedAt' | 'cancelledAt',
): void {
  if (order[field] === null || order[field] === undefined) {
    throw new Error(`Order ${order.status} requires ${field}.`);
  }
}

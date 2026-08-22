/**
 * Customer order lifecycle status vocabulary (ORD-01).
 * Legal V1 transitions live in `order-transitions.ts` (ADR 0014).
 */
export const OrderStatus = {
  PENDING_REVIEW: 'PENDING_REVIEW',
  CONFIRMED: 'CONFIRMED',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  RETURNED: 'RETURNED',
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

const ORDER_STATUS_VALUES = new Set<string>(Object.values(OrderStatus));

export function isOrderStatus(value: string): value is OrderStatus {
  return ORDER_STATUS_VALUES.has(value);
}

import { OrderStatus } from './order-status';

/**
 * Canonical V1 transition graph (ADR 0014).
 * `DELIVERED → RETURNED` is the explicit ORD-07 return-process completion edge.
 * Commands remain explicit; this table is not a public generic transition API.
 */
export const ORDER_TRANSITIONS = {
  [OrderStatus.PENDING_REVIEW]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [OrderStatus.RETURNED],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.RETURNED]: [],
} as const satisfies Record<OrderStatus, readonly OrderStatus[]>;

const LEGAL_PAIRS = new Set<string>(
  Object.entries(ORDER_TRANSITIONS).flatMap(([from, tos]) =>
    tos.map((to) => `${from}>${to}`),
  ),
);

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return LEGAL_PAIRS.has(`${from}>${to}`);
}

export const ZeroRowClassification = {
  MISSING: 'MISSING',
  REPLAY: 'REPLAY',
  INVALID: 'INVALID',
} as const;

export type ZeroRowClassification =
  (typeof ZeroRowClassification)[keyof typeof ZeroRowClassification];

/**
 * Classify a 0-row conditional UPDATE after re-reading committed Order state.
 */
export function classifyZeroRowUpdate(
  current: OrderStatus | null,
  target: OrderStatus,
): ZeroRowClassification {
  if (current === null) {
    return ZeroRowClassification.MISSING;
  }
  if (current === target) {
    return ZeroRowClassification.REPLAY;
  }
  return ZeroRowClassification.INVALID;
}

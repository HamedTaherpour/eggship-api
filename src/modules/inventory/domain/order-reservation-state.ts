import {
  InventoryReservationStatus,
  type InventoryReservation,
} from './inventory-reservation';
import type { NormalizedReservationLine } from './reservation-lines';

export const OrderReservePlan = {
  FRESH: 'FRESH',
  REPLAY: 'REPLAY',
  CONFLICT: 'CONFLICT',
} as const;

export type OrderReservePlan =
  (typeof OrderReservePlan)[keyof typeof OrderReservePlan];

export const OrderReleasePlan = {
  RELEASE: 'RELEASE',
  REPLAY: 'REPLAY',
  CONFLICT: 'CONFLICT',
  NOT_FOUND: 'NOT_FOUND',
} as const;

export type OrderReleasePlan =
  (typeof OrderReleasePlan)[keyof typeof OrderReleasePlan];

/**
 * Same-order reserve is idempotent only when every requested line already has
 * an ACTIVE row with the same quantity and there are no extra rows.
 * Partial or terminal existing state is a conflict — do not heal.
 */
export function classifyReserveAgainstExisting(
  requested: readonly NormalizedReservationLine[],
  existing: readonly InventoryReservation[],
): OrderReservePlan {
  if (existing.length === 0) {
    return OrderReservePlan.FRESH;
  }
  if (existing.length !== requested.length) {
    return OrderReservePlan.CONFLICT;
  }

  const requestedByProduct = new Map(
    requested.map((line) => [line.productId, line.quantity]),
  );
  for (const row of existing) {
    const quantity = requestedByProduct.get(row.productId);
    if (
      quantity === undefined ||
      row.status !== InventoryReservationStatus.ACTIVE ||
      row.quantity !== quantity
    ) {
      return OrderReservePlan.CONFLICT;
    }
    requestedByProduct.delete(row.productId);
  }

  return requestedByProduct.size === 0
    ? OrderReservePlan.REPLAY
    : OrderReservePlan.CONFLICT;
}

/**
 * An order's reservation rows are expected to move coherently. Mixed status is
 * an inconsistency: fail closed rather than releasing a remainder.
 */
export function classifyReleaseAgainstExisting(
  existing: readonly InventoryReservation[],
): OrderReleasePlan {
  if (existing.length === 0) {
    return OrderReleasePlan.NOT_FOUND;
  }

  const statuses = new Set(existing.map((row) => row.status));
  if (statuses.size !== 1) {
    return OrderReleasePlan.CONFLICT;
  }

  const status = existing[0]!.status;
  if (status === InventoryReservationStatus.ACTIVE) {
    return OrderReleasePlan.RELEASE;
  }
  if (status === InventoryReservationStatus.RELEASED) {
    return OrderReleasePlan.REPLAY;
  }
  return OrderReleasePlan.CONFLICT;
}

export function reservationProductIdsMatch(
  expected: readonly string[],
  existing: readonly InventoryReservation[],
): boolean {
  if (expected.length !== existing.length) {
    return false;
  }
  const remaining = new Set(existing.map((row) => row.productId));
  for (const productId of expected) {
    if (!remaining.delete(productId)) {
      return false;
    }
  }
  return remaining.size === 0;
}

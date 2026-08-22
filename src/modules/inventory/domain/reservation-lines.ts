import { InventoryInvalidQuantityError } from './inventory-errors';
import {
  INVENTORY_INT4_MAX,
  assertInventoryUuid,
  assertPositiveQuantity,
} from './inventory-quantity';

export interface ReservationLineInput {
  productId: string;
  quantity: number;
}

export interface NormalizedReservationLine {
  productId: string;
  quantity: number;
}

/**
 * Collapse duplicate product ids by summing quantities, reject empty input and
 * int4 overflow, then sort by productId ascending for deterministic locking.
 */
export function collapseReservationLines(
  lines: readonly ReservationLineInput[],
): NormalizedReservationLine[] {
  if (lines.length === 0) {
    throw new InventoryInvalidQuantityError(
      'At least one reservation line is required.',
    );
  }

  const quantities = new Map<string, number>();
  for (const line of lines) {
    const productId = assertInventoryUuid(line.productId, 'productId');
    const quantity = assertPositiveQuantity(line.quantity);
    const current = quantities.get(productId) ?? 0;
    if (current > INVENTORY_INT4_MAX - quantity) {
      throw new InventoryInvalidQuantityError(
        'Collapsed reservation quantity exceeds the maximum stock unit count.',
      );
    }
    quantities.set(productId, current + quantity);
  }

  return [...quantities.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([productId, quantity]) => ({ productId, quantity }));
}

export function shortageDetailsWithoutAvailability(
  shortages: ReadonlyArray<{ productId: string; requested: number }>,
): { lines: Array<{ productId: string; requested: number }> } {
  return {
    lines: shortages.map((row) => ({
      productId: row.productId,
      requested: row.requested,
    })),
  };
}

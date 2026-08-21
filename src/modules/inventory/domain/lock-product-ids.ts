import { InventoryInvalidQuantityError } from './inventory-errors';
import { assertInventoryUuid } from './inventory-quantity';

/**
 * Deduplicate and sort product IDs ascending for deterministic lock order.
 * Caller-controlled ORDER BY identifiers are never interpolated into SQL;
 * this helper only prepares bound parameters.
 */
export function normalizeProductIdsForLock(
  productIds: readonly string[],
): string[] {
  const unique = new Set<string>();
  for (const id of productIds) {
    unique.add(assertInventoryUuid(id, 'productId'));
  }
  return [...unique].sort((left, right) => (left < right ? -1 : 1));
}

export function assertNonEmptyProductIds(productIds: readonly string[]): void {
  if (productIds.length === 0) {
    throw new InventoryInvalidQuantityError(
      'At least one product id is required.',
    );
  }
}

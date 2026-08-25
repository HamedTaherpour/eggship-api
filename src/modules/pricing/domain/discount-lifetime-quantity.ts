import { DiscountInvalidTargetError } from './discount-errors';
import { DiscountTarget, type DiscountRecord } from './discount';
import { INVENTORY_INT4_MAX } from '../../inventory/domain/inventory-quantity';

/**
 * Optional PRODUCT-only lifetime discounted-quantity cap (DLU-02 / ADR 0017).
 * `null` means unlimited and preserves pre-DLU behavior.
 */
export function normalizeMaxQuantityPerCustomer(input: {
  target: DiscountTarget;
  maxQuantityPerCustomer?: number | null;
}): number | null {
  const raw = input.maxQuantityPerCustomer;
  if (raw === undefined || raw === null) {
    return null;
  }
  if (input.target !== DiscountTarget.PRODUCT) {
    throw new DiscountInvalidTargetError(
      'Lifetime quantity limits apply only to PRODUCT discounts.',
    );
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw new DiscountInvalidTargetError(
      'maxQuantityPerCustomer must be a positive integer when set.',
    );
  }
  if (raw > INVENTORY_INT4_MAX) {
    throw new DiscountInvalidTargetError(
      `maxQuantityPerCustomer must be at most ${INVENTORY_INT4_MAX}.`,
    );
  }
  return raw;
}

/**
 * Remaining units that may still receive this PRODUCT discount for one customer.
 * Unlimited (`null` cap) never reduces eligibility.
 */
export function remainingEligibleQuantity(input: {
  maxQuantityPerCustomer: number | null;
  consumedQuantity: number;
}): number | null {
  if (input.maxQuantityPerCustomer === null) {
    return null;
  }
  const remaining = input.maxQuantityPerCustomer - input.consumedQuantity;
  return remaining > 0 ? remaining : 0;
}

/**
 * Units that receive the LINE discount under ADR 0017 partial-discount math.
 * Unlimited remaining → full requested quantity.
 */
export function resolveDiscountedQuantity(input: {
  requestedQuantity: number;
  remainingEligibleQuantity: number | null;
}): number {
  if (input.remainingEligibleQuantity === null) {
    return input.requestedQuantity;
  }
  return Math.min(input.requestedQuantity, input.remainingEligibleQuantity);
}

/**
 * Whether a capped PRODUCT discount remains LINE-eligible for winner selection.
 * Exhausted remaining (0) removes eligibility so a CATEGORY candidate may win.
 * Unlimited caps always remain eligible from the lifetime-limit dimension.
 */
export function isLifetimeEligibleForLineWinner(
  discount: Pick<DiscountRecord, 'target' | 'maxQuantityPerCustomer'>,
  remaining: number | null | undefined,
): boolean {
  if (
    discount.target !== DiscountTarget.PRODUCT ||
    discount.maxQuantityPerCustomer === null
  ) {
    return true;
  }
  if (remaining === undefined || remaining === null) {
    // Missing locked remaining for a capped PRODUCT is a caller bug — treat as
    // ineligible rather than inventing unlimited entitlement.
    return false;
  }
  return remaining > 0;
}

export function collectCappedProductDiscountIds(
  discounts: readonly Pick<
    DiscountRecord,
    'id' | 'target' | 'maxQuantityPerCustomer'
  >[],
): string[] {
  const ids = discounts
    .filter(
      (discount) =>
        discount.target === DiscountTarget.PRODUCT &&
        discount.maxQuantityPerCustomer !== null,
    )
    .map((discount) => discount.id);
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

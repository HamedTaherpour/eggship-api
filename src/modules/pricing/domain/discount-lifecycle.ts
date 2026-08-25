import type { DiscountPayload, DiscountRecord } from './discount';
import { normalizeMaxQuantityPerCustomer } from './discount-lifetime-quantity';
import { normalizeDiscountTargetScope } from './discount-target';
import { normalizeDiscountTypeValues } from './discount-value';
import { normalizeDiscountWindow } from './discount-window';

/**
 * Whether `now` falls inside the optional activation window.
 * Null bounds mean unbounded on that side.
 */
export function isWithinActivationWindow(
  record: Pick<DiscountRecord, 'startsAt' | 'endsAt'>,
  now: Date,
): boolean {
  if (record.startsAt !== null && now.getTime() < record.startsAt.getTime()) {
    return false;
  }
  if (record.endsAt !== null && now.getTime() >= record.endsAt.getTime()) {
    return false;
  }
  return true;
}

/**
 * Whether a discount could apply at `now` from lifecycle + window only.
 * Calculation eligibility also requires target match and calculable shape (PRC-03).
 * Expired-but-active rows (`isActive = true`, past `endsAt`) return false here
 * but remain stored until an admin deactivates or updates them.
 */
export function isPotentiallyApplicable(
  record: Pick<DiscountRecord, 'isActive' | 'startsAt' | 'endsAt'>,
  now: Date,
): boolean {
  return record.isActive && isWithinActivationWindow(record, now);
}

/** Merge and validate a full discount payload from create/update parts. */
export function buildDiscountPayload(base: {
  name: string;
  type: DiscountPayload['type'];
  target: DiscountPayload['target'];
  percentValue?: number | null;
  fixedAmount?: number | null;
  productId?: string | null;
  categoryId?: string | null;
  isActive: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
  precedence: number;
  maxQuantityPerCustomer?: number | null;
}): DiscountPayload {
  const typeValues = normalizeDiscountTypeValues(base);
  const targetScope = normalizeDiscountTargetScope(base);
  const window = normalizeDiscountWindow(base);
  const maxQuantityPerCustomer = normalizeMaxQuantityPerCustomer({
    target: base.target,
    maxQuantityPerCustomer: base.maxQuantityPerCustomer,
  });

  return {
    name: base.name,
    type: base.type,
    target: base.target,
    ...typeValues,
    ...targetScope,
    isActive: base.isActive,
    ...window,
    precedence: base.precedence,
    maxQuantityPerCustomer,
  };
}

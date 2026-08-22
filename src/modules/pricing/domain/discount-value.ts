import {
  PRODUCT_PRICE_MAX_TOMAN,
  PRODUCT_PRICE_MIN_TOMAN,
} from '../../products/domain/product-price';
import {
  DiscountInvalidFixedAmountError,
  DiscountInvalidPercentError,
  DiscountInvalidTypeValueError,
} from './discount-errors';
import { DiscountType, type DiscountPayload } from './discount';

/** Inclusive whole-number percentage bounds for PERCENT discounts. */
export const DISCOUNT_PERCENT_MIN = 1;
export const DISCOUNT_PERCENT_MAX = 100;

/**
 * Validate and normalize a PERCENT discount value as a whole-number percentage.
 * Rejects floats and out-of-range values.
 */
export function normalizeDiscountPercent(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new DiscountInvalidPercentError(
      'Discount percent value must be a whole number.',
    );
  }

  if (raw < DISCOUNT_PERCENT_MIN || raw > DISCOUNT_PERCENT_MAX) {
    throw new DiscountInvalidPercentError(
      `Discount percent value must be between ${DISCOUNT_PERCENT_MIN} and ${DISCOUNT_PERCENT_MAX}.`,
    );
  }

  return raw;
}

/**
 * Validate and normalize a FIXED discount amount as integer Toman.
 * Reuses Product int4 bounds — no floating-point money.
 */
export function normalizeDiscountFixedAmount(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new DiscountInvalidFixedAmountError(
      'Discount fixed amount must be an integer number of Toman.',
    );
  }

  if (raw < PRODUCT_PRICE_MIN_TOMAN || raw > PRODUCT_PRICE_MAX_TOMAN) {
    throw new DiscountInvalidFixedAmountError(
      `Discount fixed amount must be between ${PRODUCT_PRICE_MIN_TOMAN} and ${PRODUCT_PRICE_MAX_TOMAN} Toman.`,
    );
  }

  return raw;
}

/** Normalize type-specific value columns for a complete discount payload. */
export function normalizeDiscountTypeValues(payload: {
  type: DiscountType;
  percentValue?: number | null;
  fixedAmount?: number | null;
}): Pick<DiscountPayload, 'percentValue' | 'fixedAmount'> {
  if (payload.type === DiscountType.PERCENT) {
    if (payload.percentValue === undefined || payload.percentValue === null) {
      throw new DiscountInvalidTypeValueError(
        'PERCENT discounts require percentValue.',
      );
    }
    return {
      percentValue: normalizeDiscountPercent(payload.percentValue),
      fixedAmount: null,
    };
  }

  if (payload.fixedAmount === undefined || payload.fixedAmount === null) {
    throw new DiscountInvalidTypeValueError(
      'FIXED discounts require fixedAmount.',
    );
  }
  return {
    percentValue: null,
    fixedAmount: normalizeDiscountFixedAmount(payload.fixedAmount),
  };
}

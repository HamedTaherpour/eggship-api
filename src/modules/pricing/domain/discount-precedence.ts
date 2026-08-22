import { DiscountInvalidPrecedenceError } from './discount-errors';

/** PostgreSQL int4 bounds for precedence input. */
export const DISCOUNT_PRECEDENCE_MIN = -2_147_483_648;
export const DISCOUNT_PRECEDENCE_MAX = 2_147_483_647;

export function normalizeDiscountPrecedence(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new DiscountInvalidPrecedenceError(
      'Discount precedence must be an integer.',
    );
  }

  if (raw < DISCOUNT_PRECEDENCE_MIN || raw > DISCOUNT_PRECEDENCE_MAX) {
    throw new DiscountInvalidPrecedenceError(
      `Discount precedence must be between ${DISCOUNT_PRECEDENCE_MIN} and ${DISCOUNT_PRECEDENCE_MAX}.`,
    );
  }

  return raw;
}

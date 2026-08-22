import { DiscountInvalidNameError } from './discount-errors';

/** Maximum stored length for Discount.name (matches Prisma VarChar(100)). */
export const DISCOUNT_NAME_MAX_LENGTH = 100;

/** Canonicalize a discount display name for persistence. */
export function normalizeDiscountName(raw: string): string {
  if (typeof raw !== 'string') {
    throw new DiscountInvalidNameError('Discount name must be a string.');
  }

  const name = raw.trim();
  if (name.length < 1 || name.length > DISCOUNT_NAME_MAX_LENGTH) {
    throw new DiscountInvalidNameError(
      `Discount name must be between 1 and ${DISCOUNT_NAME_MAX_LENGTH} characters after trimming.`,
    );
  }

  return name;
}

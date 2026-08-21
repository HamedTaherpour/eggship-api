import { ProductInvalidPriceError } from './product-errors';

/**
 * Minimum current selling price in integer Toman.
 * Zero is rejected as an initial commercial rule pending MIG-01 evidence.
 */
export const PRODUCT_PRICE_MIN_TOMAN = 1;

/**
 * Maximum current selling price in integer Toman (PostgreSQL `integer` / int4).
 * Fits in JavaScript Number safely (well below Number.MAX_SAFE_INTEGER).
 */
export const PRODUCT_PRICE_MAX_TOMAN = 2_147_483_647;

/**
 * Validate and normalize current Product price as integer Toman.
 * Rejects non-integers, negatives, zero, and values above int4 max.
 */
export function normalizeProductPrice(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new ProductInvalidPriceError(
      'Product price must be an integer number of Toman.',
    );
  }

  if (raw < PRODUCT_PRICE_MIN_TOMAN || raw > PRODUCT_PRICE_MAX_TOMAN) {
    throw new ProductInvalidPriceError(
      `Product price must be between ${PRODUCT_PRICE_MIN_TOMAN} and ${PRODUCT_PRICE_MAX_TOMAN} Toman.`,
    );
  }

  return raw;
}

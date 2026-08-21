import { ProductInvalidNameError } from './product-errors';

/** Maximum stored length for Product.name (matches Prisma VarChar(100)). */
export const PRODUCT_NAME_MAX_LENGTH = 100;

/**
 * Canonicalize a product display name for persistence.
 * Trim only — do not invent case-folding or Unicode normalization beyond trim.
 */
export function normalizeProductName(raw: string): string {
  if (typeof raw !== 'string') {
    throw new ProductInvalidNameError('Product name must be a string.');
  }

  const name = raw.trim();
  if (name.length < 1 || name.length > PRODUCT_NAME_MAX_LENGTH) {
    throw new ProductInvalidNameError(
      `Product name must be between 1 and ${PRODUCT_NAME_MAX_LENGTH} characters after trimming.`,
    );
  }

  return name;
}

import { OrderInvalidLineError } from './order-errors';

const MAX_PRODUCT_NAME_LENGTH = 100;

/**
 * Normalize and validate an order-time product name snapshot.
 */
export function normalizeOrderLineProductName(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new OrderInvalidLineError(
      'Order line product name must be a string.',
    );
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PRODUCT_NAME_LENGTH) {
    throw new OrderInvalidLineError(
      `Order line product name must be between 1 and ${MAX_PRODUCT_NAME_LENGTH} characters after trimming.`,
    );
  }

  return trimmed;
}

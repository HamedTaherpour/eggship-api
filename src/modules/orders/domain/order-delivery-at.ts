import { OrderInvalidInputError } from './order-errors';
import { OrderMessage } from './order-messages';

/**
 * Instant timestamps only. No "must be in the future" rule.
 * Distinct from actual `deliveredAt`.
 */
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

export function parseOptionalDeliveryAt(
  raw: Date | string | undefined,
): Date | undefined {
  if (raw === undefined) {
    return undefined;
  }
  return parseDeliveryAt(raw);
}

export function parseDeliveryAt(raw: Date | string): Date {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) {
      throw new OrderInvalidInputError(OrderMessage.INVALID_DELIVERY_AT);
    }
    return raw;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!ISO_INSTANT.test(trimmed)) {
      throw new OrderInvalidInputError(OrderMessage.INVALID_DELIVERY_AT);
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new OrderInvalidInputError(OrderMessage.INVALID_DELIVERY_AT);
    }
    return parsed;
  }
  throw new OrderInvalidInputError(OrderMessage.INVALID_DELIVERY_AT);
}

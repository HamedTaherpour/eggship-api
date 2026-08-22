import { isCanonicalIranianPhone } from '../../users/domain/iranian-phone';
import { normalizeRegionName } from '../../regions/domain/region-name';
import {
  OrderInvalidInputError,
  OrderInvalidRegionError,
  OrderInvalidUserError,
} from './order-errors';

/**
 * Validate immutable customer phone snapshot at order creation.
 */
export function normalizeCustomerPhoneSnapshot(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new OrderInvalidUserError(
      'Customer phone snapshot must be a string.',
    );
  }
  if (!isCanonicalIranianPhone(raw)) {
    throw new OrderInvalidUserError(
      'Customer phone snapshot must be canonical E.164 (+989…).',
    );
  }
  return raw;
}

/**
 * Validate immutable region name snapshot at order creation.
 */
export function normalizeRegionNameSnapshot(raw: unknown): string {
  try {
    return normalizeRegionName(raw as string);
  } catch {
    throw new OrderInvalidRegionError(
      'Region name snapshot must be a trimmed non-empty string up to 100 characters.',
    );
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function assertOrderUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new OrderInvalidInputError(`${field} must be a UUID.`);
  }
  return value.toLowerCase();
}

export function assertOptionalIdempotencyKey(
  raw: string | undefined,
): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  return assertOrderUuid(raw, 'idempotencyKey');
}

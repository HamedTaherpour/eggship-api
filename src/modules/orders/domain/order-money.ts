import {
  PRODUCT_PRICE_MAX_TOMAN,
  PRODUCT_PRICE_MIN_TOMAN,
} from '../../products/domain/product-price';
import { assertPositiveQuantity } from '../../inventory/domain/inventory-quantity';
import { OrderInvalidMoneyError } from './order-errors';

/**
 * PostgreSQL BIGINT upper bound for persisted order money columns.
 * Values remain exact integer Toman — no floating point.
 */
export const ORDER_MONEY_MAX_TOMAN = 9_223_372_036_854_775_807n;

/**
 * JavaScript Number.MAX_SAFE_INTEGER — API JSON may emit numbers only below this.
 * Order totals above this remain exact in PostgreSQL but serialize as strings at HTTP.
 */
export const ORDER_MONEY_JSON_SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Compute line total as integer Toman: unitPrice × quantity.
 * Uses bigint arithmetic to avoid int4 overflow on multiplication.
 */
export function computeLineTotal(unitPrice: number, quantity: number): bigint {
  assertOrderUnitPrice(unitPrice);
  assertPositiveQuantity(quantity, 'quantity');

  const total = BigInt(unitPrice) * BigInt(quantity);
  assertOrderMoneyAmount(total, 'lineTotal');
  return total;
}

/**
 * Sum line totals into order subtotal/total. Rejects overflow above BIGINT max.
 */
export function sumOrderLineTotals(lineTotals: readonly bigint[]): bigint {
  let sum = 0n;
  for (const lineTotal of lineTotals) {
    assertOrderMoneyAmount(lineTotal, 'lineTotal');
    sum += lineTotal;
    assertOrderMoneyAmount(sum, 'subtotal');
  }
  return sum;
}

export function assertOrderUnitPrice(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new OrderInvalidMoneyError(
      'Order unit price must be an integer number of Toman.',
    );
  }
  if (raw < PRODUCT_PRICE_MIN_TOMAN || raw > PRODUCT_PRICE_MAX_TOMAN) {
    throw new OrderInvalidMoneyError(
      `Order unit price must be between ${PRODUCT_PRICE_MIN_TOMAN} and ${PRODUCT_PRICE_MAX_TOMAN} Toman.`,
    );
  }
  return raw;
}

export function assertOrderMoneyAmount(raw: unknown, field = 'amount'): bigint {
  if (typeof raw !== 'bigint') {
    throw new OrderInvalidMoneyError(
      `${field} must be a bigint integer number of Toman.`,
    );
  }
  if (raw < 0n || raw > ORDER_MONEY_MAX_TOMAN) {
    throw new OrderInvalidMoneyError(
      `${field} must be between 0 and ${ORDER_MONEY_MAX_TOMAN} Toman.`,
    );
  }
  return raw;
}

/**
 * Map persisted bigint Toman to JSON-safe representation for future HTTP layers.
 * Numbers when within MAX_SAFE_INTEGER; otherwise decimal strings (never float).
 */
export function orderMoneyToJson(value: bigint): number | string {
  assertOrderMoneyAmount(value);
  if (value <= ORDER_MONEY_JSON_SAFE_MAX) {
    return Number(value);
  }
  return value.toString(10);
}

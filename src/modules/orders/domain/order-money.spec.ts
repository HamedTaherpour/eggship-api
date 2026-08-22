import { InventoryInvalidQuantityError } from '../../inventory/domain/inventory-errors';
import { INVENTORY_INT4_MAX } from '../../inventory/domain/inventory-quantity';
import {
  PRODUCT_PRICE_MAX_TOMAN,
  PRODUCT_PRICE_MIN_TOMAN,
} from '../../products/domain/product-price';
import {
  computeLineTotal,
  orderMoneyToJson,
  ORDER_MONEY_JSON_SAFE_MAX,
  ORDER_MONEY_MAX_TOMAN,
  sumOrderLineTotals,
} from './order-money';
import { OrderInvalidMoneyError } from './order-errors';

describe('order money', () => {
  it('computes line total with bigint multiplication', () => {
    expect(computeLineTotal(625_000, 3)).toBe(1_875_000n);
  });

  it('handles unit price at int4 max with quantity 2 without int4 overflow', () => {
    const total = computeLineTotal(PRODUCT_PRICE_MAX_TOMAN, 2);
    expect(total).toBe(BigInt(PRODUCT_PRICE_MAX_TOMAN) * 2n);
  });

  it('rejects non-positive unit prices', () => {
    expect(() => computeLineTotal(0, 1)).toThrow(OrderInvalidMoneyError);
    expect(() => computeLineTotal(PRODUCT_PRICE_MIN_TOMAN - 1, 1)).toThrow(
      OrderInvalidMoneyError,
    );
  });

  it('rejects non-positive quantities', () => {
    expect(() => computeLineTotal(1000, 0)).toThrow(
      InventoryInvalidQuantityError,
    );
  });

  it('sums multiple line totals deterministically', () => {
    expect(sumOrderLineTotals([1000n, 2000n, 3000n])).toBe(6000n);
  });

  it('rejects subtotal overflow above BIGINT max', () => {
    expect(() => sumOrderLineTotals([ORDER_MONEY_MAX_TOMAN, 1n])).toThrow(
      OrderInvalidMoneyError,
    );
  });

  it('maps bigint totals to JSON number when within MAX_SAFE_INTEGER', () => {
    expect(orderMoneyToJson(1_875_000n)).toBe(1_875_000);
  });

  it('maps large bigint totals to decimal strings without floating point', () => {
    const large = ORDER_MONEY_JSON_SAFE_MAX + 1n;
    expect(orderMoneyToJson(large)).toBe(large.toString(10));
  });

  it('documents safe quantity bound for int4 inventory alignment', () => {
    expect(computeLineTotal(1, INVENTORY_INT4_MAX)).toBe(
      BigInt(INVENTORY_INT4_MAX),
    );
  });
});

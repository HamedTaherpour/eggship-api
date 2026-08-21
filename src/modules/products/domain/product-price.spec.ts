import {
  normalizeProductPrice,
  PRODUCT_PRICE_MAX_TOMAN,
  PRODUCT_PRICE_MIN_TOMAN,
} from './product-price';
import { ProductInvalidPriceError } from './product-errors';

describe('normalizeProductPrice', () => {
  it('accepts a positive integer Toman price', () => {
    expect(normalizeProductPrice(625000)).toBe(625000);
  });

  it('rejects zero as an initial commercial rule', () => {
    expect(() => normalizeProductPrice(0)).toThrow(ProductInvalidPriceError);
  });

  it('rejects negative prices', () => {
    expect(() => normalizeProductPrice(-1)).toThrow(ProductInvalidPriceError);
  });

  it('rejects non-integers and non-numbers', () => {
    expect(() => normalizeProductPrice(12.5)).toThrow(ProductInvalidPriceError);
    expect(() => normalizeProductPrice('625000')).toThrow(
      ProductInvalidPriceError,
    );
    expect(() => normalizeProductPrice(NaN)).toThrow(ProductInvalidPriceError);
  });

  it('rejects values above PostgreSQL integer max', () => {
    expect(() => normalizeProductPrice(PRODUCT_PRICE_MAX_TOMAN + 1)).toThrow(
      ProductInvalidPriceError,
    );
  });

  it('documents min/max bounds', () => {
    expect(PRODUCT_PRICE_MIN_TOMAN).toBe(1);
    expect(PRODUCT_PRICE_MAX_TOMAN).toBe(2_147_483_647);
    expect(normalizeProductPrice(PRODUCT_PRICE_MIN_TOMAN)).toBe(1);
    expect(normalizeProductPrice(PRODUCT_PRICE_MAX_TOMAN)).toBe(
      PRODUCT_PRICE_MAX_TOMAN,
    );
  });
});

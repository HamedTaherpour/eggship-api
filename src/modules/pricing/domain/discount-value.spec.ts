import {
  DISCOUNT_PERCENT_MAX,
  DISCOUNT_PERCENT_MIN,
  normalizeDiscountFixedAmount,
  normalizeDiscountPercent,
  normalizeDiscountTypeValues,
} from './discount-value';
import { DiscountType } from './discount';
import {
  DiscountInvalidFixedAmountError,
  DiscountInvalidPercentError,
  DiscountInvalidTypeValueError,
} from './discount-errors';

describe('normalizeDiscountPercent', () => {
  it('accepts whole-number percentages in range', () => {
    expect(normalizeDiscountPercent(1)).toBe(1);
    expect(normalizeDiscountPercent(25)).toBe(25);
    expect(normalizeDiscountPercent(100)).toBe(100);
  });

  it('rejects floats, zero, overflow, and non-integers', () => {
    expect(() => normalizeDiscountPercent(10.5)).toThrow(
      DiscountInvalidPercentError,
    );
    expect(() => normalizeDiscountPercent(0)).toThrow(
      DiscountInvalidPercentError,
    );
    expect(() => normalizeDiscountPercent(101)).toThrow(
      DiscountInvalidPercentError,
    );
    expect(DISCOUNT_PERCENT_MIN).toBe(1);
    expect(DISCOUNT_PERCENT_MAX).toBe(100);
  });
});

describe('normalizeDiscountFixedAmount', () => {
  it('accepts positive integer Toman', () => {
    expect(normalizeDiscountFixedAmount(50000)).toBe(50000);
  });

  it('rejects floats and non-positive values', () => {
    expect(() => normalizeDiscountFixedAmount(100.5)).toThrow(
      DiscountInvalidFixedAmountError,
    );
    expect(() => normalizeDiscountFixedAmount(0)).toThrow(
      DiscountInvalidFixedAmountError,
    );
  });
});

describe('normalizeDiscountTypeValues', () => {
  it('maps PERCENT and FIXED to mutually exclusive columns', () => {
    expect(
      normalizeDiscountTypeValues({
        type: DiscountType.PERCENT,
        percentValue: 15,
      }),
    ).toEqual({ percentValue: 15, fixedAmount: null });

    expect(
      normalizeDiscountTypeValues({
        type: DiscountType.FIXED,
        fixedAmount: 25000,
      }),
    ).toEqual({ percentValue: null, fixedAmount: 25000 });
  });

  it('requires the value column matching the type', () => {
    expect(() =>
      normalizeDiscountTypeValues({
        type: DiscountType.PERCENT,
        fixedAmount: 1000,
      }),
    ).toThrow(DiscountInvalidTypeValueError);

    expect(() =>
      normalizeDiscountTypeValues({
        type: DiscountType.FIXED,
        percentValue: 10,
      }),
    ).toThrow(DiscountInvalidTypeValueError);
  });
});

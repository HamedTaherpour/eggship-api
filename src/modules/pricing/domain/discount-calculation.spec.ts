import { DiscountTarget, DiscountType, type DiscountRecord } from './discount';
import {
  calculateDiscount,
  compareDiscountWinner,
  computeFixedDiscountAmount,
  computeLineBaseAmount,
  computePercentDiscountAmount,
  DiscountCalculationInvalidBaseAmountError,
  DiscountCalculationInvalidContextError,
  DiscountCalculationScope,
  filterEligibleDiscounts,
  isDiscountCalculable,
  isDiscountTargetCompatible,
  selectWinningDiscount,
} from './discount-calculation';

const evaluatedAt = new Date('2026-08-15T12:00:00.000Z');
const startsAt = new Date('2026-08-01T00:00:00.000Z');
const endsAt = new Date('2026-08-31T23:59:59.999Z');

function buildDiscount(
  overrides: Partial<DiscountRecord> = {},
): DiscountRecord {
  return {
    id: overrides.id ?? '00000000-0000-4000-8000-000000000001',
    name: overrides.name ?? 'Test discount',
    type: overrides.type ?? DiscountType.PERCENT,
    target: overrides.target ?? DiscountTarget.ORDER,
    percentValue:
      overrides.percentValue !== undefined
        ? overrides.percentValue
        : overrides.type === DiscountType.FIXED
          ? null
          : 10,
    fixedAmount:
      overrides.fixedAmount !== undefined
        ? overrides.fixedAmount
        : overrides.type === DiscountType.FIXED
          ? 1_000
          : null,
    productId: overrides.productId ?? null,
    categoryId: overrides.categoryId ?? null,
    isActive: overrides.isActive ?? true,
    startsAt: overrides.startsAt ?? null,
    endsAt: overrides.endsAt ?? null,
    precedence: overrides.precedence ?? 0,
    createdAt: overrides.createdAt ?? new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-08-01T00:00:00.000Z'),
  };
}

describe('computePercentDiscountAmount', () => {
  it('calculates integer percent discount with floor rounding', () => {
    expect(computePercentDiscountAmount(10_000n, 10)).toBe(1_000n);
    expect(computePercentDiscountAmount(999n, 10)).toBe(99n);
    expect(computePercentDiscountAmount(1n, 50)).toBe(0n);
  });

  it('uses bigint-safe multiplication at large bases', () => {
    const base = 2_000_000_000n;
    expect(computePercentDiscountAmount(base, 25)).toBe(500_000_000n);
  });
});

describe('computeFixedDiscountAmount', () => {
  it('caps fixed discount at the base amount', () => {
    expect(computeFixedDiscountAmount(5_000n, 1_000)).toBe(1_000n);
    expect(computeFixedDiscountAmount(500n, 1_000)).toBe(500n);
  });
});

describe('calculateDiscount', () => {
  it('applies percent calculation and never produces negative final amount', () => {
    const result = calculateDiscount({
      baseAmount: 12_345n,
      scope: DiscountCalculationScope.ORDER,
      discounts: [
        buildDiscount({
          type: DiscountType.PERCENT,
          target: DiscountTarget.ORDER,
          percentValue: 15,
          precedence: 1,
        }),
      ],
      evaluatedAt,
    });

    expect(result.baseAmount).toBe(12_345n);
    expect(result.discountAmount).toBe(1_851n);
    expect(result.finalAmount).toBe(10_494n);
    expect(result.appliedDiscount?.type).toBe(DiscountType.PERCENT);
  });

  it('applies fixed calculation capped by base amount', () => {
    const result = calculateDiscount({
      baseAmount: 800n,
      scope: DiscountCalculationScope.ORDER,
      discounts: [
        buildDiscount({
          type: DiscountType.FIXED,
          target: DiscountTarget.ORDER,
          fixedAmount: 2_000,
          percentValue: null,
          precedence: 1,
        }),
      ],
      evaluatedAt,
    });

    expect(result.discountAmount).toBe(800n);
    expect(result.finalAmount).toBe(0n);
  });

  it('ignores inactive discounts', () => {
    const result = calculateDiscount({
      baseAmount: 1_000n,
      scope: DiscountCalculationScope.ORDER,
      discounts: [
        buildDiscount({
          isActive: false,
          type: DiscountType.FIXED,
          target: DiscountTarget.ORDER,
          fixedAmount: 500,
          percentValue: null,
        }),
      ],
      evaluatedAt,
    });

    expect(result.appliedDiscount).toBeNull();
    expect(result.finalAmount).toBe(1_000n);
  });

  it('ignores not-started and expired discounts', () => {
    const notStarted = calculateDiscount({
      baseAmount: 1_000n,
      scope: DiscountCalculationScope.ORDER,
      discounts: [
        buildDiscount({
          startsAt: new Date('2026-09-01T00:00:00.000Z'),
          type: DiscountType.FIXED,
          target: DiscountTarget.ORDER,
          fixedAmount: 100,
          percentValue: null,
        }),
      ],
      evaluatedAt,
    });
    const expired = calculateDiscount({
      baseAmount: 1_000n,
      scope: DiscountCalculationScope.ORDER,
      discounts: [
        buildDiscount({
          endsAt: new Date('2026-08-01T00:00:00.000Z'),
          type: DiscountType.FIXED,
          target: DiscountTarget.ORDER,
          fixedAmount: 100,
          percentValue: null,
        }),
      ],
      evaluatedAt,
    });

    expect(notStarted.appliedDiscount).toBeNull();
    expect(expired.appliedDiscount).toBeNull();
  });

  it('applies PRODUCT target from server line context only', () => {
    const productId = '11111111-1111-4111-8111-111111111111';
    const matching = calculateDiscount({
      baseAmount: 2_000n,
      scope: DiscountCalculationScope.LINE,
      lineContext: {
        productId,
        categoryId: '22222222-2222-4222-8222-222222222222',
      },
      discounts: [
        buildDiscount({
          target: DiscountTarget.PRODUCT,
          productId,
          type: DiscountType.FIXED,
          fixedAmount: 300,
          percentValue: null,
        }),
        buildDiscount({
          id: '00000000-0000-4000-8000-000000000002',
          target: DiscountTarget.PRODUCT,
          productId: '99999999-9999-4999-8999-999999999999',
          type: DiscountType.FIXED,
          fixedAmount: 900,
          percentValue: null,
        }),
      ],
      evaluatedAt,
    });

    expect(matching.discountAmount).toBe(300n);
    expect(matching.appliedDiscount?.target).toBe(DiscountTarget.PRODUCT);
  });

  it('applies CATEGORY target from server line context only', () => {
    const categoryId = '33333333-3333-4333-8333-333333333333';
    const result = calculateDiscount({
      baseAmount: 4_000n,
      scope: DiscountCalculationScope.LINE,
      lineContext: {
        productId: '44444444-4444-4444-8444-444444444444',
        categoryId,
      },
      discounts: [
        buildDiscount({
          target: DiscountTarget.CATEGORY,
          categoryId,
          type: DiscountType.PERCENT,
          percentValue: 25,
        }),
      ],
      evaluatedAt,
    });

    expect(result.discountAmount).toBe(1_000n);
    expect(result.appliedDiscount?.target).toBe(DiscountTarget.CATEGORY);
  });

  it('applies ORDER target only at order scope', () => {
    const orderDiscount = buildDiscount({
      target: DiscountTarget.ORDER,
      type: DiscountType.FIXED,
      fixedAmount: 250,
      percentValue: null,
    });

    const orderResult = calculateDiscount({
      baseAmount: 5_000n,
      scope: DiscountCalculationScope.ORDER,
      discounts: [orderDiscount],
      evaluatedAt,
    });
    const lineResult = calculateDiscount({
      baseAmount: 5_000n,
      scope: DiscountCalculationScope.LINE,
      lineContext: {
        productId: '55555555-5555-4555-8555-555555555555',
        categoryId: '66666666-6666-4666-8666-666666666666',
      },
      discounts: [orderDiscount],
      evaluatedAt,
    });

    expect(orderResult.discountAmount).toBe(250n);
    expect(lineResult.appliedDiscount).toBeNull();
  });

  it('selects the highest-precedence winner', () => {
    const result = calculateDiscount({
      baseAmount: 10_000n,
      scope: DiscountCalculationScope.ORDER,
      discounts: [
        buildDiscount({
          id: '00000000-0000-4000-8000-000000000001',
          type: DiscountType.FIXED,
          target: DiscountTarget.ORDER,
          fixedAmount: 100,
          percentValue: null,
          precedence: 1,
        }),
        buildDiscount({
          id: '00000000-0000-4000-8000-000000000002',
          type: DiscountType.FIXED,
          target: DiscountTarget.ORDER,
          fixedAmount: 500,
          percentValue: null,
          precedence: 10,
        }),
      ],
      evaluatedAt,
    });

    expect(result.discountAmount).toBe(500n);
    expect(result.appliedDiscount?.discountId).toBe(
      '00000000-0000-4000-8000-000000000002',
    );
  });

  it('breaks equal precedence deterministically by ascending discount id', () => {
    const lowId = buildDiscount({
      id: '00000000-0000-4000-8000-000000000001',
      type: DiscountType.FIXED,
      target: DiscountTarget.ORDER,
      fixedAmount: 100,
      percentValue: null,
      precedence: 5,
    });
    const highId = buildDiscount({
      id: '00000000-0000-4000-8000-000000000002',
      type: DiscountType.FIXED,
      target: DiscountTarget.ORDER,
      fixedAmount: 200,
      percentValue: null,
      precedence: 5,
    });

    expect(selectWinningDiscount([highId, lowId])?.id).toBe(lowId.id);
    expect(compareDiscountWinner(lowId, highId)).toBeLessThan(0);

    const result = calculateDiscount({
      baseAmount: 1_000n,
      scope: DiscountCalculationScope.ORDER,
      discounts: [highId, lowId],
      evaluatedAt,
    });
    expect(result.discountAmount).toBe(100n);
  });

  it('returns no discount when nothing is eligible', () => {
    const result = calculateDiscount({
      baseAmount: 1_000n,
      scope: DiscountCalculationScope.ORDER,
      discounts: [],
      evaluatedAt,
    });

    expect(result.appliedDiscount).toBeNull();
    expect(result.discountAmount).toBe(0n);
    expect(result.finalAmount).toBe(1_000n);
  });

  it('skips malformed persisted discounts safely', () => {
    const malformed = buildDiscount({
      type: DiscountType.PERCENT,
      percentValue: null,
    });
    expect(isDiscountCalculable(malformed)).toBe(false);

    const result = calculateDiscount({
      baseAmount: 1_000n,
      scope: DiscountCalculationScope.ORDER,
      discounts: [
        malformed,
        buildDiscount({
          id: '00000000-0000-4000-8000-000000000099',
          type: DiscountType.FIXED,
          target: DiscountTarget.ORDER,
          fixedAmount: 50,
          percentValue: null,
        }),
      ],
      evaluatedAt,
    });

    expect(result.discountAmount).toBe(50n);
  });

  it('is deterministic for repeated identical inputs', () => {
    const input = {
      baseAmount: 7_777n,
      scope: DiscountCalculationScope.ORDER,
      discounts: [
        buildDiscount({
          id: '00000000-0000-4000-8000-000000000010',
          precedence: 3,
          type: DiscountType.PERCENT,
          target: DiscountTarget.ORDER,
          percentValue: 7,
        }),
        buildDiscount({
          id: '00000000-0000-4000-8000-000000000011',
          precedence: 3,
          type: DiscountType.PERCENT,
          target: DiscountTarget.ORDER,
          percentValue: 9,
        }),
      ],
      evaluatedAt,
    };

    const first = calculateDiscount(input);
    const second = calculateDiscount(input);
    expect(second).toEqual(first);
  });

  it('rejects invalid base amounts', () => {
    expect(() =>
      calculateDiscount({
        baseAmount: -1n,
        scope: DiscountCalculationScope.ORDER,
        discounts: [],
        evaluatedAt,
      }),
    ).toThrow(DiscountCalculationInvalidBaseAmountError);
  });

  it('requires line context for LINE scope', () => {
    expect(() =>
      calculateDiscount({
        baseAmount: 100n,
        scope: DiscountCalculationScope.LINE,
        discounts: [],
        evaluatedAt,
      }),
    ).toThrow(DiscountCalculationInvalidContextError);
  });
});

describe('filterEligibleDiscounts', () => {
  it('respects activation window boundaries at evaluation instant', () => {
    const windowed = buildDiscount({
      startsAt,
      endsAt,
      type: DiscountType.FIXED,
      target: DiscountTarget.ORDER,
      fixedAmount: 100,
      percentValue: null,
    });

    const eligible = filterEligibleDiscounts({
      scope: DiscountCalculationScope.ORDER,
      discounts: [windowed],
      evaluatedAt: new Date('2026-08-15T12:00:00.000Z'),
    });
    const beforeStart = filterEligibleDiscounts({
      scope: DiscountCalculationScope.ORDER,
      discounts: [windowed],
      evaluatedAt: new Date('2026-07-31T23:59:59.999Z'),
    });

    expect(eligible).toHaveLength(1);
    expect(beforeStart).toHaveLength(0);
  });

  it('rejects evaluation at endsAt boundary (exclusive end)', () => {
    const windowed = buildDiscount({
      startsAt,
      endsAt,
      type: DiscountType.FIXED,
      target: DiscountTarget.ORDER,
      fixedAmount: 100,
      percentValue: null,
    });

    const atEnd = filterEligibleDiscounts({
      scope: DiscountCalculationScope.ORDER,
      discounts: [windowed],
      evaluatedAt: endsAt,
    });

    expect(atEnd).toHaveLength(0);
  });
});

describe('isDiscountTargetCompatible', () => {
  it('matches targets to scope and authoritative ids', () => {
    const lineContext = {
      productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      categoryId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    };

    expect(
      isDiscountTargetCompatible(
        {
          target: DiscountTarget.PRODUCT,
          productId: lineContext.productId,
          categoryId: null,
        },
        DiscountCalculationScope.LINE,
        lineContext,
      ),
    ).toBe(true);
    expect(
      isDiscountTargetCompatible(
        {
          target: DiscountTarget.CATEGORY,
          productId: null,
          categoryId: lineContext.categoryId,
        },
        DiscountCalculationScope.LINE,
        lineContext,
      ),
    ).toBe(true);
    expect(
      isDiscountTargetCompatible(
        { target: DiscountTarget.ORDER, productId: null, categoryId: null },
        DiscountCalculationScope.ORDER,
      ),
    ).toBe(true);
  });
});

describe('computeLineBaseAmount', () => {
  it('derives line base from server unit price and quantity', () => {
    expect(computeLineBaseAmount({ unitPrice: 12_345, quantity: 3 })).toBe(
      37_035n,
    );
  });

  it('rejects overflow beyond supported bigint bounds', () => {
    expect(() =>
      computeLineBaseAmount({
        unitPrice: 2_147_483_647,
        quantity: 5_000_000_000,
      }),
    ).toThrow(DiscountCalculationInvalidBaseAmountError);
  });
});

describe('integer boundary cases', () => {
  it('accepts base amount at BIGINT max', () => {
    const base = 9_223_372_036_854_775_807n;
    const result = calculateDiscount({
      baseAmount: base,
      scope: DiscountCalculationScope.ORDER,
      discounts: [],
      evaluatedAt,
    });
    expect(result.finalAmount).toBe(base);
  });

  it('handles MAX_SAFE_INTEGER-scale bases without floating point', () => {
    const base = 9_007_199_254_740_991n;
    const result = calculateDiscount({
      baseAmount: base,
      scope: DiscountCalculationScope.ORDER,
      discounts: [
        buildDiscount({
          type: DiscountType.PERCENT,
          target: DiscountTarget.ORDER,
          percentValue: 1,
        }),
      ],
      evaluatedAt,
    });

    expect(result.discountAmount).toBe(90_071_992_547_409n);
    expect(result.finalAmount).toBe(base - result.discountAmount);
  });
});

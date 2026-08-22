import { DiscountTarget, DiscountType, type DiscountRecord } from './discount';
import { DISCOUNT_MONEY_MAX_TOMAN } from './discount-calculation';
import {
  composeOrderPricing,
  normalizeOrderPricingLineInputs,
  type OrderPricingProductContext,
} from './order-pricing';
import {
  OrderPricingInvalidInputError,
  OrderPricingInvalidLineError,
  OrderPricingInvalidMoneyError,
} from './order-pricing-errors';

const evaluatedAt = new Date('2026-08-15T12:00:00.000Z');
const PRODUCT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRODUCT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CATEGORY_EGGS = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CATEGORY_OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DISCOUNT_PRODUCT = '11111111-1111-4111-8111-111111111111';
const DISCOUNT_CATEGORY = '22222222-2222-4222-8222-222222222222';
const DISCOUNT_ORDER = '33333333-3333-4333-8333-333333333333';
const DISCOUNT_ORDER_LOW = '00000000-0000-4000-8000-000000000099';

function buildDiscount(
  overrides: Partial<DiscountRecord> = {},
): DiscountRecord {
  return {
    id: overrides.id ?? DISCOUNT_ORDER,
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

function line(
  overrides: Partial<OrderPricingProductContext> = {},
): OrderPricingProductContext {
  return {
    productId: overrides.productId ?? PRODUCT_A,
    productName: overrides.productName ?? 'Fresh eggs',
    categoryId: overrides.categoryId ?? CATEGORY_EGGS,
    unitPrice: overrides.unitPrice ?? 10_000,
    quantity: overrides.quantity ?? 2,
  };
}

describe('normalizeOrderPricingLineInputs', () => {
  it('rejects empty input', () => {
    expect(() => normalizeOrderPricingLineInputs([])).toThrow(
      OrderPricingInvalidInputError,
    );
  });

  it('collapses duplicate productIds by summing quantities', () => {
    expect(
      normalizeOrderPricingLineInputs([
        { productId: PRODUCT_B, quantity: 1 },
        { productId: PRODUCT_A, quantity: 2 },
        { productId: PRODUCT_A, quantity: 3 },
      ]),
    ).toEqual([
      { productId: PRODUCT_A, quantity: 5 },
      { productId: PRODUCT_B, quantity: 1 },
    ]);
  });

  it('rejects invalid quantity and overflow merge', () => {
    expect(() =>
      normalizeOrderPricingLineInputs([{ productId: PRODUCT_A, quantity: 0 }]),
    ).toThrow(OrderPricingInvalidLineError);

    expect(() =>
      normalizeOrderPricingLineInputs([
        { productId: PRODUCT_A, quantity: 2_147_483_647 },
        { productId: PRODUCT_A, quantity: 1 },
      ]),
    ).toThrow(OrderPricingInvalidLineError);
  });
});

describe('composeOrderPricing', () => {
  it('prices with no discounts', () => {
    const result = composeOrderPricing({
      evaluatedAt,
      lines: [line({ quantity: 3, unitPrice: 10_000 })],
      discounts: [],
    });

    expect(result.evaluatedAt).toBe(evaluatedAt);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      grossLineTotal: 30_000n,
      lineDiscountAmount: 0n,
      finalLineTotal: 30_000n,
      appliedLineDiscount: null,
    });
    expect(result).toMatchObject({
      grossSubtotal: 30_000n,
      lineDiscountTotal: 0n,
      subtotalAfterLineDiscounts: 30_000n,
      orderDiscountAmount: 0n,
      total: 30_000n,
      appliedOrderDiscount: null,
    });
  });

  it('applies a PRODUCT line discount', () => {
    const result = composeOrderPricing({
      evaluatedAt,
      lines: [line({ quantity: 2, unitPrice: 10_000 })],
      discounts: [
        buildDiscount({
          id: DISCOUNT_PRODUCT,
          target: DiscountTarget.PRODUCT,
          type: DiscountType.FIXED,
          fixedAmount: 1_500,
          productId: PRODUCT_A,
          precedence: 10,
        }),
      ],
    });

    expect(result.lines[0]!.lineDiscountAmount).toBe(1_500n);
    expect(result.lines[0]!.finalLineTotal).toBe(18_500n);
    expect(result.lines[0]!.appliedLineDiscount?.discountId).toBe(
      DISCOUNT_PRODUCT,
    );
    expect(result.total).toBe(18_500n);
  });

  it('applies a CATEGORY line discount', () => {
    const result = composeOrderPricing({
      evaluatedAt,
      lines: [line({ quantity: 1, unitPrice: 10_000 })],
      discounts: [
        buildDiscount({
          id: DISCOUNT_CATEGORY,
          target: DiscountTarget.CATEGORY,
          type: DiscountType.PERCENT,
          percentValue: 10,
          categoryId: CATEGORY_EGGS,
        }),
      ],
    });

    expect(result.lines[0]!.lineDiscountAmount).toBe(1_000n);
    expect(result.lines[0]!.finalLineTotal).toBe(9_000n);
  });

  it('applies an ORDER discount to the post-line subtotal', () => {
    const result = composeOrderPricing({
      evaluatedAt,
      lines: [line({ quantity: 1, unitPrice: 10_000 })],
      discounts: [
        buildDiscount({
          id: DISCOUNT_ORDER,
          target: DiscountTarget.ORDER,
          type: DiscountType.PERCENT,
          percentValue: 10,
        }),
      ],
    });

    expect(result.subtotalAfterLineDiscounts).toBe(10_000n);
    expect(result.orderDiscountAmount).toBe(1_000n);
    expect(result.total).toBe(9_000n);
    expect(result.appliedOrderDiscount?.discountId).toBe(DISCOUNT_ORDER);
  });

  it('composes LINE then ORDER on discounted subtotal (policy A)', () => {
    const result = composeOrderPricing({
      evaluatedAt,
      lines: [
        line({
          productId: PRODUCT_A,
          quantity: 2,
          unitPrice: 10_000,
        }),
      ],
      discounts: [
        buildDiscount({
          id: DISCOUNT_PRODUCT,
          target: DiscountTarget.PRODUCT,
          type: DiscountType.FIXED,
          fixedAmount: 2_000,
          productId: PRODUCT_A,
          precedence: 5,
        }),
        buildDiscount({
          id: DISCOUNT_ORDER,
          target: DiscountTarget.ORDER,
          type: DiscountType.PERCENT,
          percentValue: 10,
          precedence: 1,
        }),
      ],
    });

    // gross 20_000 − 2_000 line = 18_000; then 10% ORDER → 1_800; total 16_200
    expect(result.lines[0]!.grossLineTotal).toBe(20_000n);
    expect(result.lines[0]!.finalLineTotal).toBe(18_000n);
    expect(result.subtotalAfterLineDiscounts).toBe(18_000n);
    expect(result.orderDiscountAmount).toBe(1_800n);
    expect(result.total).toBe(16_200n);
  });

  it('does not apply ORDER discount to pre-discount gross when LINE applied', () => {
    const result = composeOrderPricing({
      evaluatedAt,
      lines: [line({ quantity: 1, unitPrice: 10_000 })],
      discounts: [
        buildDiscount({
          id: DISCOUNT_PRODUCT,
          target: DiscountTarget.PRODUCT,
          type: DiscountType.FIXED,
          fixedAmount: 1_000,
          productId: PRODUCT_A,
        }),
        buildDiscount({
          id: DISCOUNT_ORDER,
          target: DiscountTarget.ORDER,
          type: DiscountType.FIXED,
          fixedAmount: 500,
        }),
      ],
    });

    expect(result.grossSubtotal).toBe(10_000n);
    expect(result.subtotalAfterLineDiscounts).toBe(9_000n);
    expect(result.orderDiscountAmount).toBe(500n);
    expect(result.total).toBe(8_500n);
  });

  it('inherits PRC-03 precedence and ascending-id tie-break for LINE', () => {
    const result = composeOrderPricing({
      evaluatedAt,
      lines: [line({ quantity: 1, unitPrice: 10_000 })],
      discounts: [
        buildDiscount({
          id: DISCOUNT_CATEGORY,
          target: DiscountTarget.CATEGORY,
          type: DiscountType.PERCENT,
          percentValue: 50,
          categoryId: CATEGORY_EGGS,
          precedence: 1,
        }),
        buildDiscount({
          id: DISCOUNT_PRODUCT,
          target: DiscountTarget.PRODUCT,
          type: DiscountType.FIXED,
          fixedAmount: 100,
          productId: PRODUCT_A,
          precedence: 10,
        }),
      ],
    });

    expect(result.lines[0]!.appliedLineDiscount?.discountId).toBe(
      DISCOUNT_PRODUCT,
    );
    expect(result.lines[0]!.lineDiscountAmount).toBe(100n);
  });

  it('inherits PRC-03 ascending-id tie-break for ORDER at equal precedence', () => {
    const result = composeOrderPricing({
      evaluatedAt,
      lines: [line({ quantity: 1, unitPrice: 10_000 })],
      discounts: [
        buildDiscount({
          id: DISCOUNT_ORDER,
          target: DiscountTarget.ORDER,
          type: DiscountType.FIXED,
          fixedAmount: 300,
          precedence: 5,
        }),
        buildDiscount({
          id: DISCOUNT_ORDER_LOW,
          target: DiscountTarget.ORDER,
          type: DiscountType.FIXED,
          fixedAmount: 100,
          precedence: 5,
        }),
      ],
    });

    expect(result.appliedOrderDiscount?.discountId).toBe(DISCOUNT_ORDER_LOW);
    expect(result.orderDiscountAmount).toBe(100n);
  });

  it('ignores expired and inactive discounts', () => {
    const result = composeOrderPricing({
      evaluatedAt,
      lines: [line({ quantity: 1, unitPrice: 10_000 })],
      discounts: [
        buildDiscount({
          id: DISCOUNT_PRODUCT,
          target: DiscountTarget.PRODUCT,
          productId: PRODUCT_A,
          isActive: false,
          type: DiscountType.FIXED,
          fixedAmount: 9_000,
        }),
        buildDiscount({
          id: DISCOUNT_ORDER,
          target: DiscountTarget.ORDER,
          type: DiscountType.PERCENT,
          percentValue: 50,
          endsAt: new Date('2026-08-01T00:00:00.000Z'),
        }),
      ],
    });

    expect(result.total).toBe(10_000n);
    expect(result.appliedOrderDiscount).toBeNull();
    expect(result.lines[0]!.appliedLineDiscount).toBeNull();
  });

  it('prices multiple lines with mixed LINE and ORDER discounts', () => {
    const result = composeOrderPricing({
      evaluatedAt,
      lines: [
        line({
          productId: PRODUCT_A,
          productName: 'A',
          categoryId: CATEGORY_EGGS,
          unitPrice: 10_000,
          quantity: 1,
        }),
        line({
          productId: PRODUCT_B,
          productName: 'B',
          categoryId: CATEGORY_OTHER,
          unitPrice: 20_000,
          quantity: 2,
        }),
      ],
      discounts: [
        buildDiscount({
          id: DISCOUNT_PRODUCT,
          target: DiscountTarget.PRODUCT,
          productId: PRODUCT_A,
          type: DiscountType.FIXED,
          fixedAmount: 1_000,
        }),
        buildDiscount({
          id: DISCOUNT_CATEGORY,
          target: DiscountTarget.CATEGORY,
          categoryId: CATEGORY_OTHER,
          type: DiscountType.PERCENT,
          percentValue: 10,
        }),
        buildDiscount({
          id: DISCOUNT_ORDER,
          target: DiscountTarget.ORDER,
          type: DiscountType.FIXED,
          fixedAmount: 500,
        }),
      ],
    });

    // A: 10_000 − 1_000 = 9_000; B: 40_000 − 4_000 = 36_000; subtotal 45_000 − 500 = 44_500
    expect(result.lines[0]!.finalLineTotal).toBe(9_000n);
    expect(result.lines[1]!.finalLineTotal).toBe(36_000n);
    expect(result.grossSubtotal).toBe(50_000n);
    expect(result.lineDiscountTotal).toBe(5_000n);
    expect(result.subtotalAfterLineDiscounts).toBe(45_000n);
    expect(result.orderDiscountAmount).toBe(500n);
    expect(result.total).toBe(44_500n);
  });

  it('caps FIXED discounts at the applicable base', () => {
    const result = composeOrderPricing({
      evaluatedAt,
      lines: [line({ quantity: 1, unitPrice: 500 })],
      discounts: [
        buildDiscount({
          id: DISCOUNT_PRODUCT,
          target: DiscountTarget.PRODUCT,
          productId: PRODUCT_A,
          type: DiscountType.FIXED,
          fixedAmount: 5_000,
        }),
        buildDiscount({
          id: DISCOUNT_ORDER,
          target: DiscountTarget.ORDER,
          type: DiscountType.FIXED,
          fixedAmount: 5_000,
        }),
      ],
    });

    expect(result.lines[0]!.finalLineTotal).toBe(0n);
    expect(result.subtotalAfterLineDiscounts).toBe(0n);
    expect(result.orderDiscountAmount).toBe(0n);
    expect(result.total).toBe(0n);
  });

  it('uses floor percent rounding on LINE and ORDER', () => {
    const result = composeOrderPricing({
      evaluatedAt,
      lines: [line({ quantity: 1, unitPrice: 999 })],
      discounts: [
        buildDiscount({
          id: DISCOUNT_PRODUCT,
          target: DiscountTarget.PRODUCT,
          productId: PRODUCT_A,
          type: DiscountType.PERCENT,
          percentValue: 10,
        }),
        buildDiscount({
          id: DISCOUNT_ORDER,
          target: DiscountTarget.ORDER,
          type: DiscountType.PERCENT,
          percentValue: 10,
        }),
      ],
    });

    // LINE floor(999*10/100)=99 → 900; ORDER floor(900*10/100)=90 → 810
    expect(result.lines[0]!.lineDiscountAmount).toBe(99n);
    expect(result.subtotalAfterLineDiscounts).toBe(900n);
    expect(result.orderDiscountAmount).toBe(90n);
    expect(result.total).toBe(810n);
  });

  it('skips malformed persisted discounts without leaking details', () => {
    const malformed = buildDiscount({
      id: DISCOUNT_PRODUCT,
      target: DiscountTarget.PRODUCT,
      productId: PRODUCT_A,
      type: DiscountType.PERCENT,
      percentValue: null,
      fixedAmount: null,
    });

    const result = composeOrderPricing({
      evaluatedAt,
      lines: [line({ quantity: 1, unitPrice: 10_000 })],
      discounts: [malformed],
    });

    expect(result.total).toBe(10_000n);
    expect(result.lines[0]!.appliedLineDiscount).toBeNull();
  });

  it('uses one evaluatedAt for all lines and order scope', () => {
    const windowStart = new Date('2026-08-15T11:00:00.000Z');
    const windowEnd = new Date('2026-08-15T13:00:00.000Z');
    const result = composeOrderPricing({
      evaluatedAt,
      lines: [
        line({ productId: PRODUCT_A, quantity: 1, unitPrice: 1_000 }),
        line({
          productId: PRODUCT_B,
          categoryId: CATEGORY_OTHER,
          quantity: 1,
          unitPrice: 1_000,
        }),
      ],
      discounts: [
        buildDiscount({
          id: DISCOUNT_PRODUCT,
          target: DiscountTarget.PRODUCT,
          productId: PRODUCT_A,
          type: DiscountType.FIXED,
          fixedAmount: 100,
          startsAt: windowStart,
          endsAt: windowEnd,
        }),
        buildDiscount({
          id: DISCOUNT_CATEGORY,
          target: DiscountTarget.CATEGORY,
          categoryId: CATEGORY_OTHER,
          type: DiscountType.FIXED,
          fixedAmount: 50,
          startsAt: windowStart,
          endsAt: windowEnd,
        }),
        buildDiscount({
          id: DISCOUNT_ORDER,
          target: DiscountTarget.ORDER,
          type: DiscountType.FIXED,
          fixedAmount: 25,
          startsAt: windowStart,
          endsAt: windowEnd,
        }),
      ],
    });

    expect(result.evaluatedAt).toBe(evaluatedAt);
    expect(result.lines[0]!.lineDiscountAmount).toBe(100n);
    expect(result.lines[1]!.lineDiscountAmount).toBe(50n);
    expect(result.orderDiscountAmount).toBe(25n);
  });

  it('rejects overflow above BIGINT money bounds', () => {
    const hugeLine = line({
      unitPrice: 2_147_483_647,
      quantity: 2_147_483_647,
    });

    expect(() =>
      composeOrderPricing({
        evaluatedAt,
        lines: [
          hugeLine,
          { ...hugeLine, productId: PRODUCT_B },
          {
            ...hugeLine,
            productId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          },
        ],
        discounts: [],
      }),
    ).toThrow(OrderPricingInvalidMoneyError);

    expect(DISCOUNT_MONEY_MAX_TOMAN).toBe(9_223_372_036_854_775_807n);
  });

  it('is deterministic for repeated calculation with the same inputs', () => {
    const input = {
      evaluatedAt,
      lines: [line({ quantity: 3, unitPrice: 12_345 })],
      discounts: [
        buildDiscount({
          id: DISCOUNT_PRODUCT,
          target: DiscountTarget.PRODUCT,
          productId: PRODUCT_A,
          type: DiscountType.PERCENT,
          percentValue: 13,
        }),
        buildDiscount({
          id: DISCOUNT_ORDER,
          target: DiscountTarget.ORDER,
          type: DiscountType.FIXED,
          fixedAmount: 77,
        }),
      ],
    };

    const first = composeOrderPricing(input);
    const second = composeOrderPricing(input);
    expect(second).toEqual(first);
  });
});

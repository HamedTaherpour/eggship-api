import { hashOrderCreatePayload } from '../domain/order-create-idempotency';
import { assertTrustedCreateOrderMoney } from '../domain/order-money-invariants';
import { OrderInvalidMoneyError } from '../domain/order-errors';
import type { TrustedCreateOrderInput } from '../domain/order';

const PRODUCT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REGION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const KEY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EVALUATED_AT = new Date('2026-08-22T12:00:00.000Z');

function baseInput(
  overrides: Partial<TrustedCreateOrderInput> = {},
): TrustedCreateOrderInput {
  return {
    userId: USER_ID,
    customerPhone: '+989121234567',
    regionId: REGION_ID,
    regionName: 'Tehran',
    idempotencyKey: KEY,
    idempotencyPayloadHash: 'a'.repeat(64),
    pricingEvaluatedAt: EVALUATED_AT,
    commercePolicyRevision: 1,
    grossSubtotal: 2_000n,
    lineDiscountTotal: 0n,
    subtotalAfterLineDiscounts: 2_000n,
    orderDiscountAmount: 0n,
    total: 2_000n,
    appliedOrderDiscount: null,
    lines: [
      {
        productId: PRODUCT_A,
        productName: 'Eggs',
        unitPrice: 1_000,
        quantity: 2,
        grossLineTotal: 2_000n,
        lineDiscountAmount: 0n,
        finalLineTotal: 2_000n,
        appliedLineDiscount: null,
      },
    ],
    ...overrides,
  };
}

describe('order create domain helpers', () => {
  it('hashes create payloads stably after productId sort', () => {
    const left = hashOrderCreatePayload({
      regionId: REGION_ID,
      lines: [
        { productId: PRODUCT_A, quantity: 2 },
        { productId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', quantity: 1 },
      ],
    });
    const right = hashOrderCreatePayload({
      regionId: REGION_ID.toUpperCase(),
      lines: [
        { productId: 'EEEEEEEE-EEEE-4EEE-8EEE-EEEEEEEEEEEE', quantity: 1 },
        { productId: PRODUCT_A.toUpperCase(), quantity: 2 },
      ],
    });
    expect(left).toBe(right);
    expect(left).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts reconciled trusted money snapshots', () => {
    expect(() => assertTrustedCreateOrderMoney(baseInput())).not.toThrow();
  });

  it('rejects cross-line aggregate drift', () => {
    expect(() =>
      assertTrustedCreateOrderMoney(baseInput({ total: 1_999n })),
    ).toThrow(OrderInvalidMoneyError);
  });

  it('rejects grossLineTotal that does not match unitPrice × quantity', () => {
    expect(() =>
      assertTrustedCreateOrderMoney(
        baseInput({
          lines: [
            {
              productId: PRODUCT_A,
              productName: 'Eggs',
              unitPrice: 1_000,
              quantity: 2,
              grossLineTotal: 1_999n,
              lineDiscountAmount: 0n,
              finalLineTotal: 1_999n,
              appliedLineDiscount: null,
            },
          ],
          grossSubtotal: 1_999n,
          subtotalAfterLineDiscounts: 1_999n,
          total: 1_999n,
        }),
      ),
    ).toThrow(OrderInvalidMoneyError);
  });
});

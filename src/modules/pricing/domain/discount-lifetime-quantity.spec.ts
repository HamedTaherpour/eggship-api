import {
  collectCappedProductDiscountIds,
  isLifetimeEligibleForLineWinner,
  normalizeMaxQuantityPerCustomer,
  remainingEligibleQuantity,
  resolveDiscountedQuantity,
} from './discount-lifetime-quantity';
import { DiscountInvalidTargetError } from './discount-errors';
import { DiscountTarget, DiscountType, type DiscountRecord } from './discount';

function discount(overrides: Partial<DiscountRecord> = {}): DiscountRecord {
  const now = new Date('2026-08-25T12:00:00.000Z');
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Capped product',
    type: DiscountType.PERCENT,
    target: DiscountTarget.PRODUCT,
    percentValue: 20,
    fixedAmount: null,
    productId: '22222222-2222-4222-8222-222222222222',
    categoryId: null,
    isActive: true,
    startsAt: null,
    endsAt: null,
    precedence: 10,
    maxQuantityPerCustomer: 3,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('discount-lifetime-quantity', () => {
  describe('normalizeMaxQuantityPerCustomer', () => {
    it('allows null/omit for any target', () => {
      expect(
        normalizeMaxQuantityPerCustomer({
          target: DiscountTarget.ORDER,
        }),
      ).toBeNull();
      expect(
        normalizeMaxQuantityPerCustomer({
          target: DiscountTarget.CATEGORY,
          maxQuantityPerCustomer: null,
        }),
      ).toBeNull();
    });

    it('accepts positive integers for PRODUCT only', () => {
      expect(
        normalizeMaxQuantityPerCustomer({
          target: DiscountTarget.PRODUCT,
          maxQuantityPerCustomer: 3,
        }),
      ).toBe(3);
    });

    it('rejects non-PRODUCT caps', () => {
      expect(() =>
        normalizeMaxQuantityPerCustomer({
          target: DiscountTarget.ORDER,
          maxQuantityPerCustomer: 1,
        }),
      ).toThrow(DiscountInvalidTargetError);
      expect(() =>
        normalizeMaxQuantityPerCustomer({
          target: DiscountTarget.CATEGORY,
          maxQuantityPerCustomer: 2,
        }),
      ).toThrow(DiscountInvalidTargetError);
    });
  });

  describe('remainingEligibleQuantity', () => {
    it('returns null for unlimited caps', () => {
      expect(
        remainingEligibleQuantity({
          maxQuantityPerCustomer: null,
          consumedQuantity: 99,
        }),
      ).toBeNull();
    });

    it('floors at zero when consumed exceeds cap', () => {
      expect(
        remainingEligibleQuantity({
          maxQuantityPerCustomer: 3,
          consumedQuantity: 5,
        }),
      ).toBe(0);
    });
  });

  describe('resolveDiscountedQuantity', () => {
    it('uses full quantity when unlimited', () => {
      expect(
        resolveDiscountedQuantity({
          requestedQuantity: 5,
          remainingEligibleQuantity: null,
        }),
      ).toBe(5);
    });

    it('caps at remaining entitlement', () => {
      expect(
        resolveDiscountedQuantity({
          requestedQuantity: 5,
          remainingEligibleQuantity: 3,
        }),
      ).toBe(3);
    });
  });

  describe('isLifetimeEligibleForLineWinner', () => {
    it('keeps unlimited PRODUCT and CATEGORY eligible', () => {
      expect(
        isLifetimeEligibleForLineWinner(
          discount({ maxQuantityPerCustomer: null }),
          undefined,
        ),
      ).toBe(true);
      expect(
        isLifetimeEligibleForLineWinner(
          discount({
            target: DiscountTarget.CATEGORY,
            productId: null,
            categoryId: '33333333-3333-4333-8333-333333333333',
            maxQuantityPerCustomer: null,
          }),
          0,
        ),
      ).toBe(true);
    });

    it('removes exhausted capped PRODUCT from eligibility', () => {
      expect(isLifetimeEligibleForLineWinner(discount(), 0)).toBe(false);
      expect(isLifetimeEligibleForLineWinner(discount(), 2)).toBe(true);
    });
  });

  describe('collectCappedProductDiscountIds', () => {
    it('returns sorted unique capped PRODUCT ids', () => {
      const ids = collectCappedProductDiscountIds([
        discount({
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          maxQuantityPerCustomer: 2,
        }),
        discount({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          maxQuantityPerCustomer: 1,
        }),
        discount({
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          maxQuantityPerCustomer: null,
        }),
        discount({
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          target: DiscountTarget.CATEGORY,
          productId: null,
          categoryId: '33333333-3333-4333-8333-333333333333',
          maxQuantityPerCustomer: null,
        }),
      ]);
      expect(ids).toEqual([
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ]);
    });
  });
});

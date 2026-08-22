import { DiscountTarget } from './discount';
import { DiscountInvalidTargetError } from './discount-errors';
import { normalizeDiscountTargetScope } from './discount-target';

const PRODUCT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CATEGORY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('normalizeDiscountTargetScope', () => {
  it('clears FKs for ORDER target', () => {
    expect(
      normalizeDiscountTargetScope({ target: DiscountTarget.ORDER }),
    ).toEqual({ productId: null, categoryId: null });
  });

  it('requires productId for PRODUCT target', () => {
    expect(
      normalizeDiscountTargetScope({
        target: DiscountTarget.PRODUCT,
        productId: PRODUCT_ID,
      }),
    ).toEqual({ productId: PRODUCT_ID, categoryId: null });

    expect(() =>
      normalizeDiscountTargetScope({ target: DiscountTarget.PRODUCT }),
    ).toThrow(DiscountInvalidTargetError);
  });

  it('requires categoryId for CATEGORY target', () => {
    expect(
      normalizeDiscountTargetScope({
        target: DiscountTarget.CATEGORY,
        categoryId: CATEGORY_ID,
      }),
    ).toEqual({ productId: null, categoryId: CATEGORY_ID });
  });
});

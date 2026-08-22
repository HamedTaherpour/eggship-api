import { DiscountInvalidTargetError } from './discount-errors';
import { DiscountTarget, type DiscountPayload } from './discount';

/** Normalize target-specific FK columns for a complete discount payload. */
export function normalizeDiscountTargetScope(payload: {
  target: DiscountTarget;
  productId?: string | null;
  categoryId?: string | null;
}): Pick<DiscountPayload, 'productId' | 'categoryId'> {
  switch (payload.target) {
    case DiscountTarget.ORDER:
      if (payload.productId != null || payload.categoryId != null) {
        throw new DiscountInvalidTargetError(
          'ORDER discounts must not reference a product or category.',
        );
      }
      return { productId: null, categoryId: null };
    case DiscountTarget.PRODUCT:
      if (
        typeof payload.productId !== 'string' ||
        payload.productId.length === 0
      ) {
        throw new DiscountInvalidTargetError(
          'PRODUCT discounts require productId.',
        );
      }
      if (payload.categoryId != null) {
        throw new DiscountInvalidTargetError(
          'PRODUCT discounts must not reference categoryId.',
        );
      }
      return { productId: payload.productId, categoryId: null };
    case DiscountTarget.CATEGORY:
      if (
        typeof payload.categoryId !== 'string' ||
        payload.categoryId.length === 0
      ) {
        throw new DiscountInvalidTargetError(
          'CATEGORY discounts require categoryId.',
        );
      }
      if (payload.productId != null) {
        throw new DiscountInvalidTargetError(
          'CATEGORY discounts must not reference productId.',
        );
      }
      return { productId: null, categoryId: payload.categoryId };
    default: {
      const exhaustive: never = payload.target;
      throw new DiscountInvalidTargetError(
        `Unsupported discount target: ${String(exhaustive)}`,
      );
    }
  }
}

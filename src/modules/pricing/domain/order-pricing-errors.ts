import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';

export const OrderPricingErrorCode = {
  INVALID_INPUT: 'ORDER_PRICING_INVALID_INPUT',
  INVALID_LINE: 'ORDER_PRICING_INVALID_LINE',
  INVALID_MONEY: 'ORDER_PRICING_INVALID_MONEY',
  PRODUCT_UNAVAILABLE: 'PRODUCT_NOT_FOUND',
} as const;

export type OrderPricingErrorCode =
  (typeof OrderPricingErrorCode)[keyof typeof OrderPricingErrorCode];

export class OrderPricingInvalidInputError extends ApplicationError {
  constructor(message: string) {
    super(OrderPricingErrorCode.INVALID_INPUT, message, HttpStatus.BAD_REQUEST);
    this.name = 'OrderPricingInvalidInputError';
  }
}

export class OrderPricingInvalidLineError extends ApplicationError {
  constructor(message: string) {
    super(OrderPricingErrorCode.INVALID_LINE, message, HttpStatus.BAD_REQUEST);
    this.name = 'OrderPricingInvalidLineError';
  }
}

export class OrderPricingInvalidMoneyError extends ApplicationError {
  constructor(message: string) {
    super(OrderPricingErrorCode.INVALID_MONEY, message, HttpStatus.BAD_REQUEST);
    this.name = 'OrderPricingInvalidMoneyError';
  }
}

/**
 * Missing or non-order-sale Product (inactive product or inactive Category).
 * Uses `PRODUCT_NOT_FOUND` so callers cannot distinguish hidden vs absent.
 */
export class OrderPricingProductUnavailableError extends ApplicationError {
  constructor(message = 'Product not found.') {
    super(
      OrderPricingErrorCode.PRODUCT_UNAVAILABLE,
      message,
      HttpStatus.NOT_FOUND,
    );
    this.name = 'OrderPricingProductUnavailableError';
  }
}

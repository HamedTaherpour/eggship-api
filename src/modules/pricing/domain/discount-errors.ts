import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';

export const DiscountErrorCode = {
  NOT_FOUND: 'DISCOUNT_NOT_FOUND',
  INVALID_NAME: 'DISCOUNT_INVALID_NAME',
  INVALID_PERCENT: 'DISCOUNT_INVALID_PERCENT',
  INVALID_FIXED_AMOUNT: 'DISCOUNT_INVALID_FIXED_AMOUNT',
  INVALID_TARGET: 'DISCOUNT_INVALID_TARGET',
  INVALID_WINDOW: 'DISCOUNT_INVALID_WINDOW',
  INVALID_TYPE_VALUE: 'DISCOUNT_INVALID_TYPE_VALUE',
  INVALID_PRECEDENCE: 'DISCOUNT_INVALID_PRECEDENCE',
  INVALID_PRODUCT: 'DISCOUNT_INVALID_PRODUCT',
  INVALID_CATEGORY: 'DISCOUNT_INVALID_CATEGORY',
  USAGE_CONFLICT: 'DISCOUNT_USAGE_CONFLICT',
} as const;

export type DiscountErrorCode =
  (typeof DiscountErrorCode)[keyof typeof DiscountErrorCode];

export class DiscountNotFoundError extends ApplicationError {
  constructor(message = 'Discount not found.') {
    super(DiscountErrorCode.NOT_FOUND, message, HttpStatus.NOT_FOUND);
    this.name = 'DiscountNotFoundError';
  }
}

export class DiscountInvalidNameError extends ApplicationError {
  constructor(message = 'Discount name is invalid.') {
    super(DiscountErrorCode.INVALID_NAME, message, HttpStatus.BAD_REQUEST);
    this.name = 'DiscountInvalidNameError';
  }
}

export class DiscountInvalidPercentError extends ApplicationError {
  constructor(message = 'Discount percent value is invalid.') {
    super(DiscountErrorCode.INVALID_PERCENT, message, HttpStatus.BAD_REQUEST);
    this.name = 'DiscountInvalidPercentError';
  }
}

export class DiscountInvalidFixedAmountError extends ApplicationError {
  constructor(message = 'Discount fixed amount is invalid.') {
    super(
      DiscountErrorCode.INVALID_FIXED_AMOUNT,
      message,
      HttpStatus.BAD_REQUEST,
    );
    this.name = 'DiscountInvalidFixedAmountError';
  }
}

export class DiscountInvalidTargetError extends ApplicationError {
  constructor(message = 'Discount target scope is invalid.') {
    super(DiscountErrorCode.INVALID_TARGET, message, HttpStatus.BAD_REQUEST);
    this.name = 'DiscountInvalidTargetError';
  }
}

export class DiscountInvalidWindowError extends ApplicationError {
  constructor(message = 'Discount activation window is invalid.') {
    super(DiscountErrorCode.INVALID_WINDOW, message, HttpStatus.BAD_REQUEST);
    this.name = 'DiscountInvalidWindowError';
  }
}

export class DiscountInvalidTypeValueError extends ApplicationError {
  constructor(message = 'Discount type and value fields do not match.') {
    super(
      DiscountErrorCode.INVALID_TYPE_VALUE,
      message,
      HttpStatus.BAD_REQUEST,
    );
    this.name = 'DiscountInvalidTypeValueError';
  }
}

export class DiscountInvalidPrecedenceError extends ApplicationError {
  constructor(message = 'Discount precedence is invalid.') {
    super(
      DiscountErrorCode.INVALID_PRECEDENCE,
      message,
      HttpStatus.BAD_REQUEST,
    );
    this.name = 'DiscountInvalidPrecedenceError';
  }
}

export class DiscountInvalidProductError extends ApplicationError {
  constructor(message = 'Discount product target is invalid.') {
    super(DiscountErrorCode.INVALID_PRODUCT, message, HttpStatus.BAD_REQUEST);
    this.name = 'DiscountInvalidProductError';
  }
}

export class DiscountInvalidCategoryError extends ApplicationError {
  constructor(message = 'Discount category target is invalid.') {
    super(DiscountErrorCode.INVALID_CATEGORY, message, HttpStatus.BAD_REQUEST);
    this.name = 'DiscountInvalidCategoryError';
  }
}

export class DiscountUsageConflictError extends ApplicationError {
  constructor(message = 'Discount usage could not be updated safely.') {
    super(DiscountErrorCode.USAGE_CONFLICT, message, HttpStatus.CONFLICT);
    this.name = 'DiscountUsageConflictError';
  }
}

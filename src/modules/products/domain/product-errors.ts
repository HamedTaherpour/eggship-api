import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';

export const ProductErrorCode = {
  NOT_FOUND: 'PRODUCT_NOT_FOUND',
  INVALID_NAME: 'PRODUCT_INVALID_NAME',
  INVALID_PRICE: 'PRODUCT_INVALID_PRICE',
  INVALID_CATEGORY: 'PRODUCT_INVALID_CATEGORY',
} as const;

export type ProductErrorCode =
  (typeof ProductErrorCode)[keyof typeof ProductErrorCode];

export class ProductNotFoundError extends ApplicationError {
  constructor(message = 'Product not found.') {
    super(ProductErrorCode.NOT_FOUND, message, HttpStatus.NOT_FOUND);
    this.name = 'ProductNotFoundError';
  }
}

export class ProductInvalidNameError extends ApplicationError {
  constructor(message = 'Product name is invalid.') {
    super(ProductErrorCode.INVALID_NAME, message, HttpStatus.BAD_REQUEST);
    this.name = 'ProductInvalidNameError';
  }
}

export class ProductInvalidPriceError extends ApplicationError {
  constructor(message = 'Product price is invalid.') {
    super(ProductErrorCode.INVALID_PRICE, message, HttpStatus.BAD_REQUEST);
    this.name = 'ProductInvalidPriceError';
  }
}

export class ProductInvalidCategoryError extends ApplicationError {
  constructor(message = 'Product category is invalid.') {
    super(ProductErrorCode.INVALID_CATEGORY, message, HttpStatus.BAD_REQUEST);
    this.name = 'ProductInvalidCategoryError';
  }
}

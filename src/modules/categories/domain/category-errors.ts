import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';

export const CategoryErrorCode = {
  NOT_FOUND: 'CATEGORY_NOT_FOUND',
  INVALID_NAME: 'CATEGORY_INVALID_NAME',
} as const;

export type CategoryErrorCode =
  (typeof CategoryErrorCode)[keyof typeof CategoryErrorCode];

export class CategoryNotFoundError extends ApplicationError {
  constructor(message = 'Category not found.') {
    super(CategoryErrorCode.NOT_FOUND, message, HttpStatus.NOT_FOUND);
    this.name = 'CategoryNotFoundError';
  }
}

export class CategoryInvalidNameError extends ApplicationError {
  constructor(message = 'Category name is invalid.') {
    super(CategoryErrorCode.INVALID_NAME, message, HttpStatus.BAD_REQUEST);
    this.name = 'CategoryInvalidNameError';
  }
}

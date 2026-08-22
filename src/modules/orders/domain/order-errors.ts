import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';

export const OrderErrorCode = {
  INVALID_INPUT: 'ORDER_INVALID_INPUT',
  INVALID_MONEY: 'ORDER_INVALID_MONEY',
  INVALID_LINE: 'ORDER_INVALID_LINE',
  NOT_FOUND: 'ORDER_NOT_FOUND',
  INVALID_USER: 'ORDER_INVALID_USER',
  INVALID_REGION: 'ORDER_INVALID_REGION',
  INVALID_PRODUCT: 'ORDER_INVALID_PRODUCT',
  IDEMPOTENCY_CONFLICT: 'ORDER_IDEMPOTENCY_CONFLICT',
} as const;

export class OrderInvalidInputError extends ApplicationError {
  constructor(message: string) {
    super(OrderErrorCode.INVALID_INPUT, message, HttpStatus.BAD_REQUEST);
    this.name = 'OrderInvalidInputError';
  }
}

export class OrderInvalidMoneyError extends ApplicationError {
  constructor(message: string) {
    super(OrderErrorCode.INVALID_MONEY, message, HttpStatus.BAD_REQUEST);
    this.name = 'OrderInvalidMoneyError';
  }
}

export class OrderInvalidLineError extends ApplicationError {
  constructor(message: string) {
    super(OrderErrorCode.INVALID_LINE, message, HttpStatus.BAD_REQUEST);
    this.name = 'OrderInvalidLineError';
  }
}

export class OrderNotFoundError extends ApplicationError {
  constructor(message = 'Order not found.') {
    super(OrderErrorCode.NOT_FOUND, message, HttpStatus.NOT_FOUND);
    this.name = 'OrderNotFoundError';
  }
}

export class OrderInvalidUserError extends ApplicationError {
  constructor(message: string) {
    super(OrderErrorCode.INVALID_USER, message, HttpStatus.BAD_REQUEST);
    this.name = 'OrderInvalidUserError';
  }
}

export class OrderInvalidRegionError extends ApplicationError {
  constructor(message: string) {
    super(OrderErrorCode.INVALID_REGION, message, HttpStatus.BAD_REQUEST);
    this.name = 'OrderInvalidRegionError';
  }
}

export class OrderInvalidProductError extends ApplicationError {
  constructor(message: string) {
    super(OrderErrorCode.INVALID_PRODUCT, message, HttpStatus.BAD_REQUEST);
    this.name = 'OrderInvalidProductError';
  }
}

export class OrderIdempotencyConflictError extends ApplicationError {
  constructor(message = 'An order already exists for this idempotency key.') {
    super(OrderErrorCode.IDEMPOTENCY_CONFLICT, message, HttpStatus.CONFLICT);
    this.name = 'OrderIdempotencyConflictError';
  }
}

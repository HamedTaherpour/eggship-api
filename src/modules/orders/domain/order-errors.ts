import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';
import { OrderMessage } from './order-messages';

export const OrderErrorCode = {
  INVALID_INPUT: 'ORDER_INVALID_INPUT',
  INVALID_MONEY: 'ORDER_INVALID_MONEY',
  INVALID_LINE: 'ORDER_INVALID_LINE',
  NOT_FOUND: 'ORDER_NOT_FOUND',
  INVALID_USER: 'ORDER_INVALID_USER',
  INVALID_REGION: 'ORDER_INVALID_REGION',
  INVALID_PRODUCT: 'ORDER_INVALID_PRODUCT',
  IDEMPOTENCY_CONFLICT: 'ORDER_IDEMPOTENCY_CONFLICT',
  INVALID_TRANSITION: 'ORDER_INVALID_TRANSITION',
  CANCELLATION_REASON_REQUIRED: 'ORDER_CANCELLATION_REASON_REQUIRED',
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
  constructor(message = OrderMessage.NOT_FOUND) {
    super(OrderErrorCode.NOT_FOUND, message, HttpStatus.NOT_FOUND);
    this.name = 'OrderNotFoundError';
  }
}

export class OrderInvalidTransitionError extends ApplicationError {
  constructor(message: string = OrderMessage.INVALID_TRANSITION) {
    super(OrderErrorCode.INVALID_TRANSITION, message, HttpStatus.CONFLICT);
    this.name = 'OrderInvalidTransitionError';
  }
}

export class OrderCancellationReasonRequiredError extends ApplicationError {
  constructor(message = OrderMessage.CANCELLATION_REASON_REQUIRED) {
    super(
      OrderErrorCode.CANCELLATION_REASON_REQUIRED,
      message,
      HttpStatus.BAD_REQUEST,
    );
    this.name = 'OrderCancellationReasonRequiredError';
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
  constructor(message = OrderMessage.IDEMPOTENCY_CONFLICT) {
    super(OrderErrorCode.IDEMPOTENCY_CONFLICT, message, HttpStatus.CONFLICT);
    this.name = 'OrderIdempotencyConflictError';
  }
}

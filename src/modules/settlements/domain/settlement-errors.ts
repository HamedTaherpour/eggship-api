import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';

export const SettlementErrorCode = {
  NOT_FOUND: 'SETTLEMENT_NOT_FOUND',
  ALREADY_EXISTS: 'SETTLEMENT_ALREADY_EXISTS',
  ORDER_NOT_DELIVERED: 'SETTLEMENT_ORDER_NOT_DELIVERED',
  INVALID_DUE_DATE: 'SETTLEMENT_INVALID_DUE_DATE',
  RECEIPT_REQUIRED: 'SETTLEMENT_RECEIPT_REQUIRED',
  INVALID_TRANSITION: 'SETTLEMENT_INVALID_TRANSITION',
} as const;

export class SettlementNotFoundError extends ApplicationError {
  constructor() {
    super(
      SettlementErrorCode.NOT_FOUND,
      'Settlement not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}

export class SettlementAlreadyExistsError extends ApplicationError {
  constructor() {
    super(
      SettlementErrorCode.ALREADY_EXISTS,
      'This order already has a settlement.',
      HttpStatus.CONFLICT,
    );
  }
}

export class SettlementOrderNotDeliveredError extends ApplicationError {
  constructor() {
    super(
      SettlementErrorCode.ORDER_NOT_DELIVERED,
      'A settlement can be created only for a delivered order.',
      HttpStatus.CONFLICT,
    );
  }
}

export class SettlementInvalidDueDateError extends ApplicationError {
  constructor() {
    super(
      SettlementErrorCode.INVALID_DUE_DATE,
      'dueAt must be a valid ISO 8601 instant with a timezone.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class SettlementReceiptRequiredError extends ApplicationError {
  constructor() {
    super(
      SettlementErrorCode.RECEIPT_REQUIRED,
      'Attach a receipt before marking the settlement as settled.',
      HttpStatus.CONFLICT,
    );
  }
}

export class SettlementInvalidTransitionError extends ApplicationError {
  constructor() {
    super(
      SettlementErrorCode.INVALID_TRANSITION,
      'This settlement can no longer be changed.',
      HttpStatus.CONFLICT,
    );
  }
}

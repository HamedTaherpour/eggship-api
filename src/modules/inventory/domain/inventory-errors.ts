import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';

export const InventoryErrorCode = {
  NOT_FOUND: 'INVENTORY_NOT_FOUND',
  INSUFFICIENT_STOCK: 'INVENTORY_INSUFFICIENT_STOCK',
  INVALID_QUANTITY: 'INVENTORY_INVALID_QUANTITY',
  INVALID_ADJUSTMENT: 'INVENTORY_INVALID_ADJUSTMENT',
  RESERVATION_NOT_FOUND: 'INVENTORY_RESERVATION_NOT_FOUND',
  RESERVATION_CONFLICT: 'INVENTORY_RESERVATION_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_KEY_INVALID: 'IDEMPOTENCY_KEY_INVALID',
} as const;

export type InventoryErrorCode =
  (typeof InventoryErrorCode)[keyof typeof InventoryErrorCode];

export class InventoryNotFoundError extends ApplicationError {
  constructor(
    message = 'Inventory was not found for this product.',
    details: Record<string, unknown> = {},
  ) {
    super(InventoryErrorCode.NOT_FOUND, message, HttpStatus.NOT_FOUND, details);
    this.name = 'InventoryNotFoundError';
  }
}

export class InventoryInsufficientStockError extends ApplicationError {
  constructor(
    message = 'Not enough available stock for this reservation.',
    details: Record<string, unknown> = {},
  ) {
    super(
      InventoryErrorCode.INSUFFICIENT_STOCK,
      message,
      HttpStatus.CONFLICT,
      details,
    );
    this.name = 'InventoryInsufficientStockError';
  }
}

export class InventoryInvalidQuantityError extends ApplicationError {
  constructor(
    message = 'Inventory quantity is invalid.',
    details: Record<string, unknown> = {},
  ) {
    super(
      InventoryErrorCode.INVALID_QUANTITY,
      message,
      HttpStatus.BAD_REQUEST,
      details,
    );
    this.name = 'InventoryInvalidQuantityError';
  }
}

export class InventoryInvalidAdjustmentError extends ApplicationError {
  constructor(
    message = 'This inventory adjustment is not allowed.',
    details: Record<string, unknown> = {},
  ) {
    super(
      InventoryErrorCode.INVALID_ADJUSTMENT,
      message,
      HttpStatus.BAD_REQUEST,
      details,
    );
    this.name = 'InventoryInvalidAdjustmentError';
  }
}

export class InventoryReservationNotFoundError extends ApplicationError {
  constructor(
    message = 'Inventory reservation was not found.',
    details: Record<string, unknown> = {},
  ) {
    super(
      InventoryErrorCode.RESERVATION_NOT_FOUND,
      message,
      HttpStatus.NOT_FOUND,
      details,
    );
    this.name = 'InventoryReservationNotFoundError';
  }
}

export class InventoryReservationConflictError extends ApplicationError {
  constructor(
    message = 'This inventory reservation cannot be changed.',
    details: Record<string, unknown> = {},
  ) {
    super(
      InventoryErrorCode.RESERVATION_CONFLICT,
      message,
      HttpStatus.CONFLICT,
      details,
    );
    this.name = 'InventoryReservationConflictError';
  }
}

export class IdempotencyConflictError extends ApplicationError {
  constructor(
    message = 'This operation was already recorded with different details.',
    details: Record<string, unknown> = {},
  ) {
    super(
      InventoryErrorCode.IDEMPOTENCY_CONFLICT,
      message,
      HttpStatus.CONFLICT,
      details,
    );
    this.name = 'IdempotencyConflictError';
  }
}

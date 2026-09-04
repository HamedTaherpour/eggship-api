import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';

export const AnalyticsErrorCode = {
  INVALID_DATE_RANGE: 'ANALYTICS_INVALID_DATE_RANGE',
  RANGE_TOO_LARGE: 'ANALYTICS_RANGE_TOO_LARGE',
  INVENTORY_INVARIANT: 'ANALYTICS_INVENTORY_INVARIANT',
} as const;

export class AnalyticsInvalidDateRangeError extends ApplicationError {
  constructor(message = 'The analytics date range is invalid.') {
    super(
      AnalyticsErrorCode.INVALID_DATE_RANGE,
      message,
      HttpStatus.BAD_REQUEST,
    );
    this.name = 'AnalyticsInvalidDateRangeError';
  }
}

export class AnalyticsRangeTooLargeError extends ApplicationError {
  constructor() {
    super(
      AnalyticsErrorCode.RANGE_TOO_LARGE,
      'The analytics date range cannot exceed 366 local days.',
      HttpStatus.BAD_REQUEST,
    );
    this.name = 'AnalyticsRangeTooLargeError';
  }
}

export class AnalyticsInventoryInvariantError extends ApplicationError {
  constructor(productId: string) {
    super(
      AnalyticsErrorCode.INVENTORY_INVARIANT,
      'Inventory is missing for an existing product.',
      HttpStatus.INTERNAL_SERVER_ERROR,
      { productId },
    );
    this.name = 'AnalyticsInventoryInvariantError';
  }
}

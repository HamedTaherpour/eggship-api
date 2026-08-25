import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';

export class CommercePolicyRevisionConflictError extends ApplicationError {
  constructor(revision: number | null) {
    super(
      'COMMERCE_POLICY_REVISION_CONFLICT',
      'Commerce policy changed. Refresh and try again.',
      HttpStatus.CONFLICT,
      revision === null ? {} : { revision },
    );
  }
}
export class CommercePolicyNotInitializedError extends ApplicationError {
  constructor() {
    super(
      'COMMERCE_POLICY_NOT_INITIALIZED',
      'Commerce policy has not been initialized.',
      HttpStatus.CONFLICT,
    );
  }
}
export class CommercePolicyInvalidSettingsError extends ApplicationError {
  constructor(message = 'Commerce policy settings are invalid.') {
    super('COMMERCE_POLICY_INVALID_SETTINGS', message, HttpStatus.BAD_REQUEST);
  }
}
export class CommerceOverrideInvalidError extends ApplicationError {
  constructor(message = 'Commerce schedule override is invalid.') {
    super(
      'COMMERCE_SCHEDULE_OVERRIDE_INVALID',
      message,
      HttpStatus.BAD_REQUEST,
    );
  }
}
export class CommerceOverrideNotFoundError extends ApplicationError {
  constructor() {
    super(
      'COMMERCE_SCHEDULE_OVERRIDE_NOT_FOUND',
      'Commerce schedule override not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}

/** Customer/Order submit: missing or invalid Commerce policy (COM-03). */
export class OrderingPolicyUnavailableError extends ApplicationError {
  constructor() {
    super(
      'ORDERING_POLICY_UNAVAILABLE',
      'Ordering is temporarily unavailable. Please try again.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

/** Customer/Order submit: outside approved ordering windows (COM-03). */
export class OrderingClosedError extends ApplicationError {
  constructor() {
    super(
      'ORDERING_CLOSED',
      'Ordering is currently closed.',
      HttpStatus.CONFLICT,
    );
  }
}

/** Customer/Order submit: normalized cart quantity below minimum (COM-03). */
export class OrderMinimumQuantityNotMetError extends ApplicationError {
  constructor(minimumQuantity: number, actualQuantity: number) {
    super(
      'ORDER_MINIMUM_QUANTITY_NOT_MET',
      'The order does not meet the minimum quantity.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      { minimumQuantity, actualQuantity },
    );
  }
}

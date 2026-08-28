import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';

export const VisitorErrorCode = {
  INVALID_NAME: 'VISITOR_INVALID_NAME',
  INVALID_REFERRAL_CODE: 'REFERRAL_CODE_INVALID',
  REFERRAL_CODE_ALREADY_EXISTS: 'REFERRAL_CODE_ALREADY_EXISTS',
  VISITOR_NOT_FOUND: 'VISITOR_NOT_FOUND',
  VISITOR_INACTIVE: 'VISITOR_INACTIVE',
  ATTRIBUTION_CONFLICT: 'REFERRAL_ATTRIBUTION_CONFLICT',
} as const;

export type VisitorErrorCode =
  (typeof VisitorErrorCode)[keyof typeof VisitorErrorCode];

export class InvalidVisitorNameError extends ApplicationError {
  constructor() {
    super(VisitorErrorCode.INVALID_NAME, 'Visitor name is invalid.');
  }
}

export class InvalidReferralCodeError extends ApplicationError {
  constructor() {
    super(
      VisitorErrorCode.INVALID_REFERRAL_CODE,
      'Referral code is invalid.',
      HttpStatus.BAD_REQUEST,
      {
        field: 'referralCode',
      },
    );
  }
}

export class ReferralCodeAlreadyExistsError extends ApplicationError {
  constructor() {
    super(
      VisitorErrorCode.REFERRAL_CODE_ALREADY_EXISTS,
      'Referral code is already in use.',
      HttpStatus.CONFLICT,
    );
  }
}

export class VisitorNotFoundError extends ApplicationError {
  constructor() {
    super(
      VisitorErrorCode.VISITOR_NOT_FOUND,
      'Visitor was not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}

export class VisitorInactiveError extends ApplicationError {
  constructor() {
    super(
      VisitorErrorCode.VISITOR_INACTIVE,
      'Referral code is inactive.',
      HttpStatus.BAD_REQUEST,
      {
        field: 'referralCode',
      },
    );
  }
}

export class ReferralAttributionConflictError extends ApplicationError {
  constructor() {
    super(
      VisitorErrorCode.ATTRIBUTION_CONFLICT,
      'Referral attribution could not be completed.',
      HttpStatus.CONFLICT,
    );
  }
}

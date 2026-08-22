import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';

export const PricingErrorCode = {
  ADMIN_REQUIRED: 'PRICING_ADMIN_REQUIRED',
} as const;

export type PricingErrorCode =
  (typeof PricingErrorCode)[keyof typeof PricingErrorCode];

export class PricingAdminRequiredError extends ApplicationError {
  constructor(message = 'Admin authentication is required for price changes.') {
    super(PricingErrorCode.ADMIN_REQUIRED, message, HttpStatus.FORBIDDEN);
    this.name = 'PricingAdminRequiredError';
  }
}

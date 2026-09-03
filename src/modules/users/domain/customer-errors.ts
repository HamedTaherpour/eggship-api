import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';

export const CustomerErrorCode = {
  NOT_FOUND: 'CUSTOMER_NOT_FOUND',
} as const;

export type CustomerErrorCode =
  (typeof CustomerErrorCode)[keyof typeof CustomerErrorCode];

export class CustomerNotFoundError extends ApplicationError {
  constructor(message = 'Customer not found.') {
    super(CustomerErrorCode.NOT_FOUND, message, HttpStatus.NOT_FOUND);
    this.name = 'CustomerNotFoundError';
  }
}

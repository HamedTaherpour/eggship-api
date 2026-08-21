import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';

export const RegionErrorCode = {
  NOT_FOUND: 'REGION_NOT_FOUND',
  INVALID_NAME: 'REGION_INVALID_NAME',
} as const;

export type RegionErrorCode =
  (typeof RegionErrorCode)[keyof typeof RegionErrorCode];

export class RegionNotFoundError extends ApplicationError {
  constructor(message = 'Region not found.') {
    super(RegionErrorCode.NOT_FOUND, message, HttpStatus.NOT_FOUND);
    this.name = 'RegionNotFoundError';
  }
}

export class RegionInvalidNameError extends ApplicationError {
  constructor(message = 'Region name is invalid.') {
    super(RegionErrorCode.INVALID_NAME, message, HttpStatus.BAD_REQUEST);
    this.name = 'RegionInvalidNameError';
  }
}

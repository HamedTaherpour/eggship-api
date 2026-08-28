import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';

export const NotificationErrorCode = {
  NOT_FOUND: 'NOTIFICATION_NOT_FOUND',
} as const;

export class NotificationNotFoundError extends ApplicationError {
  constructor() {
    super(
      NotificationErrorCode.NOT_FOUND,
      'Notification not found.',
      HttpStatus.NOT_FOUND,
    );
    this.name = 'NotificationNotFoundError';
  }
}

import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';

export class AuditLogNotFoundError extends ApplicationError {
  constructor() {
    super(
      'AUDIT_LOG_NOT_FOUND',
      'Audit log entry was not found.',
      HttpStatus.NOT_FOUND,
    );
    this.name = 'AuditLogNotFoundError';
  }
}

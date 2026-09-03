/**
 * Admin domain failures.
 *
 * These are plain domain errors rather than `AuthError` values on purpose:
 * HTTP mapping remains centralized in the application error filter. In
 * particular, a duplicate-email conflict must not become a
 * pre-authentication response that discloses whether an admin email exists.
 */

import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';

export class AdminNotFoundError extends ApplicationError {
  constructor() {
    super('ADMIN_NOT_FOUND', 'Admin was not found.', HttpStatus.NOT_FOUND);
  }
}

export class AdminSelfMutationError extends ApplicationError {
  constructor(operation: 'disable' | 'role change') {
    super(
      operation === 'disable'
        ? 'ADMIN_SELF_DISABLE_FORBIDDEN'
        : 'ADMIN_SELF_ROLE_CHANGE_FORBIDDEN',
      `An Admin cannot perform this ${operation} on their own account.`,
      HttpStatus.FORBIDDEN,
    );
  }
}

export class AdminLastSuperAdminProtectedError extends ApplicationError {
  constructor() {
    super(
      'ADMIN_LAST_SUPER_' + 'ADMIN_PROTECTED',
      'The last active critical Admin cannot be disabled or demoted.',
      HttpStatus.CONFLICT,
    );
  }
}

/** The canonical email is already taken. Raised from the database unique constraint. */
export class AdminEmailAlreadyExistsError extends Error {
  constructor(message = 'An admin with this email already exists.') {
    super(message);
    this.name = 'AdminEmailAlreadyExistsError';
  }
}

/**
 * A persisted role is not a known `AdminRole`, which means the database enum and
 * the code-defined roles have drifted. Full-record reads fail loudly; the
 * authorization path never throws for this and denies with `unknown_role`.
 */
export class UnknownAdminRoleError extends Error {
  constructor(message = 'Persisted admin role is not a known AdminRole.') {
    super(message);
    this.name = 'UnknownAdminRoleError';
  }
}

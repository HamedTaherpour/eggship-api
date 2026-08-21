import type { AuthErrorCode } from './auth-error-codes';

/**
 * Domain/application Auth failure. Map to HTTP at the API boundary.
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: AuthErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.details = details;
  }
}

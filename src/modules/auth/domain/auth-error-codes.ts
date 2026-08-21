import { OtpErrorCode } from './otp-error-codes';

/**
 * Stable Auth domain error codes. HTTP mapping belongs at the API boundary.
 */
export const AuthErrorCode = {
  INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  SESSION_REVOKED: 'AUTH_SESSION_REVOKED',
  REFRESH_TOKEN_REUSED: 'AUTH_REFRESH_TOKEN_REUSED',
  REFRESH_TOKEN_MISSING: 'AUTH_REFRESH_TOKEN_MISSING',
  INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  ACCOUNT_DISABLED: 'AUTH_ACCOUNT_DISABLED',
  UNAUTHENTICATED: 'AUTH_UNAUTHENTICATED',
  /** Authenticated but not permitted. Never carries the failed policy detail. */
  FORBIDDEN: 'AUTH_FORBIDDEN',
  /** Admin (or other non-OTP) login abuse window exceeded. */
  LOGIN_RATE_LIMITED: 'AUTH_RATE_LIMITED',
  /** Required auth infrastructure unavailable (for example Redis for Admin login throttling). */
  AUTH_UNAVAILABLE: 'AUTH_UNAVAILABLE',
  VERIFICATION_GRANT_INVALID: 'AUTH_VERIFICATION_GRANT_INVALID',
  VERIFICATION_GRANT_EXPIRED: 'AUTH_VERIFICATION_GRANT_EXPIRED',
  VERIFICATION_GRANT_USED: 'AUTH_VERIFICATION_GRANT_USED',
  REGISTRATION_CONFLICT: 'AUTH_REGISTRATION_CONFLICT',
  ...OtpErrorCode,
} as const;

export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];

/**
 * Stable OTP Auth error codes. HTTP mapping belongs at the API boundary (AUTH-06).
 */
export const OtpErrorCode = {
  COOLDOWN: 'AUTH_OTP_COOLDOWN',
  RATE_LIMITED: 'AUTH_OTP_RATE_LIMITED',
  INVALID: 'AUTH_OTP_INVALID',
  EXPIRED: 'AUTH_OTP_EXPIRED',
  TOO_MANY_ATTEMPTS: 'AUTH_OTP_TOO_MANY_ATTEMPTS',
  ALREADY_USED: 'AUTH_OTP_ALREADY_USED',
  DELIVERY_FAILED: 'AUTH_OTP_DELIVERY_FAILED',
  UNAVAILABLE: 'AUTH_OTP_UNAVAILABLE',
} as const;

export type OtpErrorCode = (typeof OtpErrorCode)[keyof typeof OtpErrorCode];

/**
 * OTP purpose for customer storefront authentication (login + registration path).
 * Stored on the challenge so later flows cannot reuse a challenge for another purpose.
 */
export const OTP_PURPOSE_CUSTOMER_AUTH = 'customer_auth' as const;

export type OtpPurpose = typeof OTP_PURPOSE_CUSTOMER_AUTH;

export interface OtpChallengeRecord {
  challengeId: string;
  phone: string;
  purpose: OtpPurpose;
  codeDigest: string;
  attempts: number;
  maxAttempts: number;
  createdAtUnixMs: number;
  expiresAtUnixMs: number;
}

export interface OtpRequestResult {
  challengeId: string;
  expiresAt: Date;
  resendAvailableAt: Date;
}

/**
 * Successful verification consumes the challenge and mints a short-lived
 * verification grant. Does not issue sessions.
 */
export interface OtpVerificationResult {
  challengeId: string;
  phone: string;
  purpose: OtpPurpose;
  verifiedAt: Date;
  verificationGrantId: string;
  grantExpiresAt: Date;
}

/**
 * Trusted request-source metadata for abuse controls.
 * HTTP adapters (AUTH-06) must supply framework/proxy-resolved IP only—never
 * blindly trust arbitrary X-Forwarded-For without an approved trust configuration.
 */
export interface OtpRequestSource {
  /** Client IP as resolved by the trusted edge; hashed before Redis keys. */
  clientIp?: string;
}

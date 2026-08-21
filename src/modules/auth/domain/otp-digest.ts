import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Threat model: six-digit OTPs have low entropy. A plain unsalted SHA-256 digest
 * alone does not slow offline brute force if Redis dumps leak. HMAC-SHA256 keyed
 * with OTP_HASH_SECRET binds digests to this deployment secret so leaked Redis
 * values are not reusable against another deployment and are not usable without
 * the secret. Redis remains short-lived and access-controlled; this is defense
 * in depth, not a substitute for attempt limits and TTL.
 *
 * Never log digests or raw OTP values.
 */
export function digestOtpCode(code: string, secret: string): string {
  if (code.length === 0) {
    throw new Error('OTP code must not be empty.');
  }
  if (secret.length === 0) {
    throw new Error('OTP hash secret must not be empty.');
  }
  return createHmac('sha256', secret).update(code, 'utf8').digest('base64url');
}

/**
 * Constant-time comparison of OTP digests.
 */
export function otpDigestsEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

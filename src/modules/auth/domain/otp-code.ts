import { randomInt } from 'node:crypto';

/** OTP length is fixed product policy for AUTH-05. */
export const OTP_CODE_LENGTH = 6;

const OTP_CODE_PATTERN = /^\d{6}$/u;
const OTP_MAX_INCLUSIVE = 1_000_000;

/**
 * Returns true when value is exactly six numeric digits (leading zeros allowed).
 */
export function isOtpCode(value: string): boolean {
  return OTP_CODE_PATTERN.test(value);
}

/**
 * Formats an integer in [0, 999999] as a six-digit OTP string with leading zeros.
 */
export function formatOtpCode(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value >= OTP_MAX_INCLUSIVE) {
    throw new Error('OTP numeric value must be an integer in [0, 999999].');
  }
  return value.toString().padStart(OTP_CODE_LENGTH, '0');
}

/**
 * Generates a six-digit OTP using cryptographically secure randomness.
 * Every value from 000000 through 999999 is equally likely.
 */
export function generateSecureOtpCode(): string {
  return formatOtpCode(randomInt(0, OTP_MAX_INCLUSIVE));
}

/**
 * Asserts a configured development OTP code shape without embedding a fixed value.
 */
export function assertConfiguredOtpCode(code: string, envName: string): string {
  const trimmed = code.trim();
  if (!isOtpCode(trimmed)) {
    throw new Error(`${envName} must be exactly six numeric digits.`);
  }
  return trimmed;
}

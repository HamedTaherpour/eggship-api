/**
 * Canonical Iranian mobile phone identity for EggShip users.
 *
 * Storage form: E.164 with country code 98, e.g. +989121234567
 * National mobile numbers are 10 digits starting with 9 after the country code.
 */

const CANONICAL_PATTERN = /^\+989\d{9}$/u;

export class InvalidIranianPhoneError extends Error {
  constructor(message = 'Invalid Iranian mobile phone number.') {
    super(message);
    this.name = 'InvalidIranianPhoneError';
  }
}

/**
 * Returns true when `value` is already in canonical E.164 form.
 */
export function isCanonicalIranianPhone(value: string): boolean {
  return CANONICAL_PATTERN.test(value);
}

/**
 * Normalizes common Iranian mobile input forms to canonical E.164.
 *
 * Accepted examples after trimming: 09121234567, 9121234567, +989121234567,
 * 00989121234567, 989121234567.
 */
export function normalizeIranianPhone(input: string): string {
  let digits = input
    .trim()
    .replace(/[\s()-]/gu, '')
    .replace(/^\+/u, '');

  if (!/^\d+$/u.test(digits)) {
    throw new InvalidIranianPhoneError();
  }

  // International dialing prefix 00 is equivalent to +
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  let national: string;

  if (digits.startsWith('98') && digits.length === 12) {
    national = digits.slice(2);
  } else if (digits.startsWith('0') && digits.length === 11) {
    national = digits.slice(1);
  } else if (digits.length === 10) {
    national = digits;
  } else {
    throw new InvalidIranianPhoneError();
  }

  if (!/^9\d{9}$/u.test(national)) {
    throw new InvalidIranianPhoneError();
  }

  return `+98${national}`;
}

import { randomBytes } from 'node:crypto';
import { InvalidReferralCodeError } from './visitor-errors';

export const REFERRAL_CODE_LENGTH = 10;
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeReferralCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (
    normalized.length < 6 ||
    normalized.length > REFERRAL_CODE_LENGTH ||
    !new RegExp(`^[${REFERRAL_CODE_ALPHABET}]+$`).test(normalized)
  ) {
    throw new InvalidReferralCodeError();
  }
  return normalized;
}

export function generateReferralCode(): string {
  const bytes = randomBytes(REFERRAL_CODE_LENGTH);
  return Array.from(
    bytes,
    (byte) => REFERRAL_CODE_ALPHABET[byte % REFERRAL_CODE_ALPHABET.length],
  ).join('');
}

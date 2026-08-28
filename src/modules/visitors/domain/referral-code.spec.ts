import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  generateReferralCode,
  normalizeReferralCode,
} from './referral-code';
import { InvalidReferralCodeError } from './visitor-errors';

describe('referral codes', () => {
  it('normalizes trim/case consistently', () => {
    expect(normalizeReferralCode(' abcd2345ef ')).toBe('ABCD2345EF');
  });

  it('rejects ambiguous, short, and unsafe codes', () => {
    expect(() => normalizeReferralCode('ABC01O')).toThrow(
      InvalidReferralCodeError,
    );
    expect(() => normalizeReferralCode('ABCDE')).toThrow(
      InvalidReferralCodeError,
    );
    expect(() => normalizeReferralCode('ABCDEF-123')).toThrow(
      InvalidReferralCodeError,
    );
  });

  it('generates bounded manual-entry-safe codes', () => {
    const code = generateReferralCode();
    expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
    expect(
      [...code].every((character) =>
        REFERRAL_CODE_ALPHABET.includes(character),
      ),
    ).toBe(true);
    expect(normalizeReferralCode(code)).toBe(code);
  });
});

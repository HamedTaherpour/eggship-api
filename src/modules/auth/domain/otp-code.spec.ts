import {
  assertConfiguredOtpCode,
  formatOtpCode,
  generateSecureOtpCode,
  isOtpCode,
} from './otp-code';

describe('otp-code', () => {
  it('accepts exactly six numeric digits including leading zeros', () => {
    expect(isOtpCode('000000')).toBe(true);
    expect(isOtpCode('999999')).toBe(true);
    expect(isOtpCode('111111')).toBe(true);
    expect(isOtpCode('12345')).toBe(false);
    expect(isOtpCode('1234567')).toBe(false);
    expect(isOtpCode('12a456')).toBe(false);
  });

  it('formats the full 000000–999999 range without bias helpers', () => {
    expect(formatOtpCode(0)).toBe('000000');
    expect(formatOtpCode(42)).toBe('000042');
    expect(formatOtpCode(999_999)).toBe('999999');
    expect(() => formatOtpCode(-1)).toThrow();
    expect(() => formatOtpCode(1_000_000)).toThrow();
  });

  it('generates CSPRNG six-digit codes within the valid domain', () => {
    const samples = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const code = generateSecureOtpCode();
      expect(isOtpCode(code)).toBe(true);
      samples.add(code);
    }
    expect(samples.size).toBeGreaterThan(1);
  });

  it('validates configured development codes without embedding a fixed bypass', () => {
    expect(assertConfiguredOtpCode('000000', 'OTP_DEV_CODE')).toBe('000000');
    expect(() => assertConfiguredOtpCode('abc', 'OTP_DEV_CODE')).toThrow(
      'OTP_DEV_CODE must be exactly six numeric digits.',
    );
  });
});

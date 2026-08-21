import {
  InvalidIranianPhoneError,
  isCanonicalIranianPhone,
  normalizeIranianPhone,
} from './iranian-phone';

describe('normalizeIranianPhone', () => {
  it.each([
    ['09121234567', '+989121234567'],
    ['9121234567', '+989121234567'],
    ['+989121234567', '+989121234567'],
    ['00989121234567', '+989121234567'],
    ['989121234567', '+989121234567'],
    [' 0912 123 4567 ', '+989121234567'],
    ['+98-912-123-4567', '+989121234567'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeIranianPhone(input)).toBe(expected);
  });

  it.each([
    '',
    'abc',
    '08121234567',
    '0912123456',
    '091212345678',
    '+18885551212',
    '+9809121234567',
  ])('rejects invalid input %s', (input) => {
    expect(() => normalizeIranianPhone(input)).toThrow(
      InvalidIranianPhoneError,
    );
  });
});

describe('isCanonicalIranianPhone', () => {
  it('accepts canonical E.164 mobiles', () => {
    expect(isCanonicalIranianPhone('+989121234567')).toBe(true);
  });

  it.each(['09121234567', '+98912123456', '+981212345678', ''])(
    'rejects non-canonical value %s',
    (value) => {
      expect(isCanonicalIranianPhone(value)).toBe(false);
    },
  );
});

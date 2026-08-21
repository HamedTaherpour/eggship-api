import { digestOtpCode, otpDigestsEqual } from './otp-digest';

describe('otp-digest', () => {
  const secret = 'unit-test-otp-hash-secret-32chars!!!!';

  it('produces stable HMAC digests for the same code and secret', () => {
    const left = digestOtpCode('123456', secret);
    const right = digestOtpCode('123456', secret);
    expect(left).toBe(right);
    expect(otpDigestsEqual(left, right)).toBe(true);
  });

  it('changes digest when the code or secret changes', () => {
    const baseline = digestOtpCode('123456', secret);
    expect(digestOtpCode('123457', secret)).not.toBe(baseline);
    expect(digestOtpCode('123456', `${secret}x`)).not.toBe(baseline);
  });

  it('rejects empty inputs', () => {
    expect(() => digestOtpCode('', secret)).toThrow();
    expect(() => digestOtpCode('123456', '')).toThrow();
  });
});

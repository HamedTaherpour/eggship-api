import { DevelopmentSmsProvider } from './development-sms-provider';
import { DevelopmentOtpCodeIssuer } from './development-otp-code-issuer';

describe('development OTP adapters', () => {
  it('issues the configured development code without hardcoding verification bypasses', () => {
    const issuer = new DevelopmentOtpCodeIssuer('654321');
    expect(issuer.issueCode()).toBe('654321');
  });

  it('never sends SMS', async () => {
    const provider = new DevelopmentSmsProvider();
    await expect(
      provider.sendOtp({ phone: '+989121234567', code: '111111' }),
    ).resolves.toBeUndefined();
  });
});

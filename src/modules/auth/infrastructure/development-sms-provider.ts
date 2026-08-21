import { Injectable } from '@nestjs/common';
import type { SmsProvider } from '../domain/sms-provider';

/**
 * Development SMS adapter: never sends SMS. OTP delivery is a no-op so
 * developers authenticate with the configured development code.
 */
@Injectable()
export class DevelopmentSmsProvider implements SmsProvider {
  async sendOtp(input: { phone: string; code: string }): Promise<void> {
    void input;
    await Promise.resolve();
  }
}

import { Injectable } from '@nestjs/common';
import type { OtpCodeIssuer } from '../domain/otp-code-issuer';

/**
 * Development-only issuer. Returns the configured OTP_DEV_CODE.
 * Must never be selected when NODE_ENV=production.
 */
@Injectable()
export class DevelopmentOtpCodeIssuer implements OtpCodeIssuer {
  constructor(private readonly configuredCode: string) {}

  issueCode(): string {
    return this.configuredCode;
  }
}

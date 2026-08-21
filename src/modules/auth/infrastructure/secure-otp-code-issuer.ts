import { Injectable } from '@nestjs/common';
import { generateSecureOtpCode } from '../domain/otp-code';
import type { OtpCodeIssuer } from '../domain/otp-code-issuer';

@Injectable()
export class SecureOtpCodeIssuer implements OtpCodeIssuer {
  issueCode(): string {
    return generateSecureOtpCode();
  }
}

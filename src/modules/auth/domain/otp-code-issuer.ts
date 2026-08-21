/**
 * Issues OTP codes. Production uses CSPRNG; development returns configured code.
 * Fixed development values must never live in generic verification logic.
 */
export interface OtpCodeIssuer {
  issueCode(): string;
}

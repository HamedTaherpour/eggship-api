import type { OtpPurpose } from './otp-challenge';

/**
 * Short-lived server-side proof that OTP verification succeeded for a phone/purpose.
 * Clients receive only `grantId`; AUTH-07+ consumes the grant server-side.
 */
export interface OtpVerificationGrantRecord {
  grantId: string;
  phone: string;
  purpose: OtpPurpose;
  challengeId: string;
  createdAtUnixMs: number;
  expiresAtUnixMs: number;
}

export interface CreateOtpVerificationGrantInput {
  grantId: string;
  phone: string;
  purpose: OtpPurpose;
  challengeId: string;
  ttlSeconds: number;
  createdAtUnixMs: number;
}

export type ConsumeOtpVerificationGrantOutcome =
  | { status: 'matched'; record: OtpVerificationGrantRecord }
  | { status: 'missing' }
  | { status: 'expired' }
  | { status: 'already_used' };

/**
 * Ephemeral OTP verification-grant persistence (Redis).
 * Grants are single-use and short-lived; they are not sessions or bearer tokens.
 */
export interface OtpVerificationGrantStore {
  createGrant(input: CreateOtpVerificationGrantInput): Promise<void>;

  /**
   * Atomically reads and deletes a grant when present and unexpired.
   * Concurrent consumers must yield exactly one `matched` outcome.
   */
  consumeGrant(grantId: string): Promise<ConsumeOtpVerificationGrantOutcome>;
}

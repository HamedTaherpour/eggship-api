import type { OtpChallengeRecord, OtpPurpose } from '../domain/otp-challenge';

export interface CreateOtpChallengeInput {
  challengeId: string;
  phone: string;
  purpose: OtpPurpose;
  codeDigest: string;
  maxAttempts: number;
  ttlSeconds: number;
  resendCooldownSeconds: number;
  createdAtUnixMs: number;
}

export type CreateOtpChallengeOutcome =
  | { status: 'created'; previousChallengeId: string | null }
  | { status: 'cooldown'; retryAfterSeconds: number };

export type ConsumeOtpChallengeOutcome =
  | { status: 'matched'; record: OtpChallengeRecord }
  | { status: 'mismatch'; attempts: number; remainingAttempts: number }
  | { status: 'locked' }
  | { status: 'missing' }
  | { status: 'expired' }
  | { status: 'already_used' };

export type ConsumeOtpChallengeAndMintGrantOutcome =
  | {
      status: 'matched';
      record: OtpChallengeRecord;
      verificationGrantId: string;
      grantExpiresAtUnixMs: number;
    }
  | { status: 'mismatch'; attempts: number; remainingAttempts: number }
  | { status: 'locked' }
  | { status: 'missing' }
  | { status: 'expired' }
  | { status: 'already_used' };

export interface ConsumeOtpChallengeAndMintGrantInput {
  challengeId: string;
  codeDigest: string;
  grantId: string;
  grantTtlSeconds: number;
  grantCreatedAtUnixMs: number;
}

export interface OtpRateLimitWindow {
  limit: number;
  windowSeconds: number;
}

/**
 * Ephemeral OTP challenge and abuse-state persistence (Redis).
 * Implementations must use atomic operations for consume and race-sensitive counters.
 */
export interface OtpStore {
  /**
   * Returns remaining cooldown seconds for the phone, or null when no cooldown is active.
   * Used to reject resends without consuming request-window budget.
   */
  getPhoneCooldownRemaining(phone: string): Promise<number | null>;

  createChallenge(
    input: CreateOtpChallengeInput,
  ): Promise<CreateOtpChallengeOutcome>;

  /**
   * Atomically verifies digest and consumes the challenge on success, or increments
   * failed attempts (invalidating at max) under concurrency.
   */
  consumeChallenge(input: {
    challengeId: string;
    codeDigest: string;
  }): Promise<ConsumeOtpChallengeOutcome>;

  /**
   * Atomically verifies digest, consumes the challenge, and mints a verification
   * grant on success. Challenge must not be consumed unless the grant is written.
   */
  consumeChallengeAndMintGrant(
    input: ConsumeOtpChallengeAndMintGrantInput,
  ): Promise<ConsumeOtpChallengeAndMintGrantOutcome>;

  deleteChallenge(challengeId: string, phone: string): Promise<void>;

  incrementPhoneRequestCount(
    phone: string,
    window: OtpRateLimitWindow,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }>;

  incrementIpRequestCount(
    ipFingerprint: string,
    window: OtpRateLimitWindow,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}

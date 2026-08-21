import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import {
  InvalidIranianPhoneError,
  normalizeIranianPhone,
} from '../../users/domain/iranian-phone';
import {
  OTP_CODE_ISSUER,
  OTP_STORE,
  OTP_VERIFICATION_GRANT_STORE,
  SMS_PROVIDER,
} from '../auth.tokens';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import {
  OTP_PURPOSE_CUSTOMER_AUTH,
  type OtpRequestResult,
  type OtpRequestSource,
  type OtpVerificationResult,
} from '../domain/otp-challenge';
import { isOtpCode } from '../domain/otp-code';
import type { OtpCodeIssuer } from '../domain/otp-code-issuer';
import { digestOtpCode } from '../domain/otp-digest';
import type { OtpStore } from '../domain/otp-store';
import type {
  OtpVerificationGrantRecord,
  OtpVerificationGrantStore,
} from '../domain/otp-verification-grant';
import { SmsDeliveryError, type SmsProvider } from '../domain/sms-provider';
import { fingerprintSensitiveValue } from '../infrastructure/otp-redis-keys';

const CHALLENGE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const GRANT_ID_PATTERN = CHALLENGE_ID_PATTERN;

export interface RequestOtpInput {
  phone: string;
  source?: OtpRequestSource;
}

export interface VerifyOtpInput {
  challengeId: string;
  code: string;
}

/**
 * OTP request/verify application primitives plus short-lived verification grants.
 * Does not issue sessions or query User for enumeration.
 *
 * Provider failure policy: create challenge (and cooldown) first, then send SMS.
 * On delivery failure, delete the challenge so clients are not left with a usable
 * silent challenge. Cooldown remains to limit SMS-cost retries during outages.
 *
 * Abuse accounting: peek cooldown before charging phone/IP windows so cooldown
 * probes cannot exhaust a victim's hourly request budget.
 */
@Injectable()
export class OtpService {
  private readonly hashSecret: string;
  private readonly ttlSeconds: number;
  private readonly maxAttempts: number;
  private readonly resendCooldownSeconds: number;
  private readonly phoneWindowLimit: number;
  private readonly phoneWindowSeconds: number;
  private readonly ipWindowLimit: number;
  private readonly ipWindowSeconds: number;
  private readonly verificationGrantTtlSeconds: number;

  constructor(
    @Inject(OTP_STORE) private readonly store: OtpStore,
    @Inject(OTP_VERIFICATION_GRANT_STORE)
    private readonly grants: OtpVerificationGrantStore,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(OTP_CODE_ISSUER) private readonly codes: OtpCodeIssuer,
    private readonly logger: ApplicationLogger,
    config: ConfigService,
  ) {
    this.hashSecret = config.getOrThrow<string>('OTP_HASH_SECRET');
    this.ttlSeconds = config.getOrThrow<number>('OTP_TTL_SECONDS');
    this.maxAttempts = config.getOrThrow<number>('OTP_MAX_ATTEMPTS');
    this.resendCooldownSeconds = config.getOrThrow<number>(
      'OTP_RESEND_COOLDOWN_SECONDS',
    );
    this.phoneWindowLimit = config.getOrThrow<number>('OTP_PHONE_WINDOW_LIMIT');
    this.phoneWindowSeconds = config.getOrThrow<number>(
      'OTP_PHONE_WINDOW_SECONDS',
    );
    this.ipWindowLimit = config.getOrThrow<number>('OTP_IP_WINDOW_LIMIT');
    this.ipWindowSeconds = config.getOrThrow<number>('OTP_IP_WINDOW_SECONDS');
    this.verificationGrantTtlSeconds = config.getOrThrow<number>(
      'OTP_VERIFICATION_GRANT_TTL_SECONDS',
    );
  }

  async requestOtp(input: RequestOtpInput): Promise<OtpRequestResult> {
    const phone = this.normalizePhone(input.phone);
    const clientIp = input.source?.clientIp?.trim();

    const cooldownRemaining = await this.store.getPhoneCooldownRemaining(phone);
    if (cooldownRemaining !== null) {
      this.logger.info(
        {
          module: 'auth',
          operation: 'auth.otp.request.rejected',
          reason: 'cooldown',
          retryAfterSeconds: cooldownRemaining,
        },
        'OTP request rejected by resend cooldown',
      );
      throw new AuthError(
        AuthErrorCode.COOLDOWN,
        'OTP resend cooldown is active. Try again later.',
        { retryAfterSeconds: cooldownRemaining },
      );
    }

    if (clientIp !== undefined && clientIp !== '') {
      const ipLimit = await this.store.incrementIpRequestCount(
        fingerprintSensitiveValue(clientIp),
        {
          limit: this.ipWindowLimit,
          windowSeconds: this.ipWindowSeconds,
        },
      );
      if (!ipLimit.allowed) {
        this.logRequestRejected('ip', ipLimit.retryAfterSeconds);
        throw new AuthError(
          AuthErrorCode.RATE_LIMITED,
          'Too many OTP requests. Try again later.',
          { retryAfterSeconds: ipLimit.retryAfterSeconds },
        );
      }
    }

    const phoneLimit = await this.store.incrementPhoneRequestCount(phone, {
      limit: this.phoneWindowLimit,
      windowSeconds: this.phoneWindowSeconds,
    });
    if (!phoneLimit.allowed) {
      this.logRequestRejected('phone', phoneLimit.retryAfterSeconds);
      throw new AuthError(
        AuthErrorCode.RATE_LIMITED,
        'Too many OTP requests. Try again later.',
        { retryAfterSeconds: phoneLimit.retryAfterSeconds },
      );
    }

    const challengeId = randomUUID();
    const code = this.codes.issueCode();
    const codeDigest = digestOtpCode(code, this.hashSecret);
    const createdAtUnixMs = Date.now();

    const created = await this.store.createChallenge({
      challengeId,
      phone,
      purpose: OTP_PURPOSE_CUSTOMER_AUTH,
      codeDigest,
      maxAttempts: this.maxAttempts,
      ttlSeconds: this.ttlSeconds,
      resendCooldownSeconds: this.resendCooldownSeconds,
      createdAtUnixMs,
    });

    if (created.status === 'cooldown') {
      this.logger.info(
        {
          module: 'auth',
          operation: 'auth.otp.request.rejected',
          reason: 'cooldown_race',
          retryAfterSeconds: created.retryAfterSeconds,
        },
        'OTP request rejected by resend cooldown',
      );
      throw new AuthError(
        AuthErrorCode.COOLDOWN,
        'OTP resend cooldown is active. Try again later.',
        { retryAfterSeconds: created.retryAfterSeconds },
      );
    }

    try {
      await this.sms.sendOtp({ phone, code });
    } catch (error: unknown) {
      await this.store.deleteChallenge(challengeId, phone);
      this.logger.error(
        {
          module: 'auth',
          operation: 'auth.otp.request.rejected',
          reason: 'delivery_failed',
          challengeId,
        },
        'OTP SMS delivery failed',
        error instanceof Error ? error : new SmsDeliveryError(),
      );
      throw new AuthError(
        AuthErrorCode.DELIVERY_FAILED,
        'OTP delivery failed. Try again later.',
      );
    }

    const expiresAt = new Date(createdAtUnixMs + this.ttlSeconds * 1000);
    const resendAvailableAt = new Date(
      createdAtUnixMs + this.resendCooldownSeconds * 1000,
    );

    this.logger.info(
      {
        module: 'auth',
        operation: 'auth.otp.request.succeeded',
        challengeId,
        expiresAt: expiresAt.toISOString(),
      },
      'OTP challenge created',
    );

    return { challengeId, expiresAt, resendAvailableAt };
  }

  async verifyOtp(input: VerifyOtpInput): Promise<OtpVerificationResult> {
    const challengeId = input.challengeId.trim();
    const code = input.code;

    if (!CHALLENGE_ID_PATTERN.test(challengeId) || !isOtpCode(code)) {
      this.logVerifyRejected('invalid_input');
      throw new AuthError(AuthErrorCode.INVALID, 'OTP verification failed.');
    }

    const codeDigest = digestOtpCode(code, this.hashSecret);
    const grantId = randomUUID();
    const verifiedAt = new Date();
    const grantCreatedAtUnixMs = verifiedAt.getTime();
    const outcome = await this.store.consumeChallengeAndMintGrant({
      challengeId,
      codeDigest,
      grantId,
      grantTtlSeconds: this.verificationGrantTtlSeconds,
      grantCreatedAtUnixMs,
    });

    switch (outcome.status) {
      case 'matched': {
        this.logger.info(
          {
            module: 'auth',
            operation: 'auth.otp.verify.succeeded',
            challengeId,
            verificationGrantId: outcome.verificationGrantId,
          },
          'OTP challenge verified',
        );
        return {
          challengeId: outcome.record.challengeId,
          phone: outcome.record.phone,
          purpose: outcome.record.purpose,
          verifiedAt,
          verificationGrantId: outcome.verificationGrantId,
          grantExpiresAt: new Date(outcome.grantExpiresAtUnixMs),
        };
      }
      case 'mismatch':
        this.logVerifyRejected('mismatch');
        throw new AuthError(AuthErrorCode.INVALID, 'OTP verification failed.');
      case 'locked':
        this.logVerifyRejected('too_many_attempts');
        throw new AuthError(
          AuthErrorCode.TOO_MANY_ATTEMPTS,
          'OTP challenge is locked after too many attempts.',
        );
      case 'expired':
        this.logVerifyRejected('expired');
        throw new AuthError(
          AuthErrorCode.EXPIRED,
          'OTP challenge has expired.',
        );
      case 'already_used':
        this.logVerifyRejected('already_used');
        throw new AuthError(
          AuthErrorCode.ALREADY_USED,
          'OTP challenge was already used.',
        );
      case 'missing':
        this.logVerifyRejected('missing');
        throw new AuthError(AuthErrorCode.INVALID, 'OTP verification failed.');
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  }

  /**
   * Consumes a verification grant for AUTH-07+ registration/login orchestration.
   * Not exposed over HTTP in AUTH-06.
   */
  async consumeVerificationGrant(
    grantId: string,
  ): Promise<OtpVerificationGrantRecord> {
    const normalized = grantId.trim();
    if (!GRANT_ID_PATTERN.test(normalized)) {
      throw new AuthError(AuthErrorCode.INVALID, 'OTP verification failed.');
    }

    const outcome = await this.grants.consumeGrant(normalized);
    switch (outcome.status) {
      case 'matched':
        return outcome.record;
      case 'missing':
        throw new AuthError(AuthErrorCode.INVALID, 'OTP verification failed.');
      case 'expired':
        throw new AuthError(
          AuthErrorCode.EXPIRED,
          'OTP verification grant has expired.',
        );
      case 'already_used':
        throw new AuthError(
          AuthErrorCode.ALREADY_USED,
          'OTP verification grant was already used.',
        );
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  }

  private normalizePhone(phone: string): string {
    try {
      return normalizeIranianPhone(phone);
    } catch (error: unknown) {
      if (error instanceof InvalidIranianPhoneError) {
        throw error;
      }
      throw error;
    }
  }

  private logRequestRejected(
    reason: 'phone' | 'ip',
    retryAfterSeconds: number,
  ): void {
    this.logger.info(
      {
        module: 'auth',
        operation: 'auth.otp.request.rejected',
        reason,
        retryAfterSeconds,
      },
      'OTP request rate limited',
    );
  }

  private logVerifyRejected(reason: string): void {
    this.logger.info(
      {
        module: 'auth',
        operation: 'auth.otp.verify.rejected',
        reason,
      },
      'OTP verification rejected',
    );
  }
}

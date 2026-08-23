import { Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import type { OtpChallengeRecord, OtpPurpose } from '../domain/otp-challenge';
import type {
  ConsumeOtpChallengeAndMintGrantInput,
  ConsumeOtpChallengeAndMintGrantOutcome,
  ConsumeOtpChallengeOutcome,
  CreateOtpChallengeInput,
  CreateOtpChallengeOutcome,
  OtpRateLimitWindow,
  OtpStore,
} from '../domain/otp-store';
import {
  fingerprintSensitiveValue,
  otpChallengeKey,
  otpIpWindowKey,
  otpPhoneActiveKey,
  otpPhoneCooldownKey,
  otpPhoneWindowKey,
  OTP_REDIS_KEY_PREFIX,
  otpRedisKeyTtlSeconds,
  otpVerificationGrantKey,
  otpWindowBucketId,
} from './otp-redis-keys';
import {
  OTP_CHALLENGE_KEY_PREFIX,
  OTP_CONSUME_AND_MINT_GRANT_LUA,
  OTP_CONSUME_CHALLENGE_LUA,
  OTP_CREATE_CHALLENGE_LUA,
  OTP_DELETE_CHALLENGE_LUA,
  OTP_RATE_LIMIT_LUA,
  otpConsumedKey,
} from './otp-lua-scripts';

@Injectable()
export class RedisOtpStore implements OtpStore {
  constructor(private readonly redis: RedisService) {}

  async getPhoneCooldownRemaining(phone: string): Promise<number | null> {
    return this.withRedis(async (client) => {
      const ttl = await client.ttl(
        otpPhoneCooldownKey(fingerprintSensitiveValue(phone)),
      );
      if (ttl <= 0) {
        return null;
      }
      return ttl;
    });
  }

  async createChallenge(
    input: CreateOtpChallengeInput,
  ): Promise<CreateOtpChallengeOutcome> {
    return this.withRedis(async (client) => {
      const phoneFingerprint = fingerprintSensitiveValue(input.phone);
      const expiresAtUnixMs = input.createdAtUnixMs + input.ttlSeconds * 1000;

      const result = (await client.eval(
        OTP_CREATE_CHALLENGE_LUA,
        3,
        otpPhoneCooldownKey(phoneFingerprint),
        otpPhoneActiveKey(phoneFingerprint),
        otpChallengeKey(input.challengeId),
        String(input.resendCooldownSeconds),
        String(otpRedisKeyTtlSeconds(input.ttlSeconds)),
        input.challengeId,
        input.phone,
        input.purpose,
        input.codeDigest,
        String(input.maxAttempts),
        String(input.createdAtUnixMs),
        String(expiresAtUnixMs),
        OTP_CHALLENGE_KEY_PREFIX,
        phoneFingerprint,
      )) as [number, string | number];

      if (result[0] === 0) {
        return {
          status: 'cooldown',
          retryAfterSeconds: Math.max(1, Number(result[1])),
        };
      }

      const previous = String(result[1] ?? '');
      return {
        status: 'created',
        previousChallengeId: previous === '' ? null : previous,
      };
    });
  }

  async consumeChallenge(input: {
    challengeId: string;
    codeDigest: string;
  }): Promise<ConsumeOtpChallengeOutcome> {
    return this.withRedis(async (client) => {
      const nowUnixMs = Date.now();

      const result = (await client.eval(
        OTP_CONSUME_CHALLENGE_LUA,
        2,
        otpChallengeKey(input.challengeId),
        otpConsumedKey(input.challengeId),
        input.codeDigest,
        String(nowUnixMs),
        OTP_REDIS_KEY_PREFIX,
        '300',
      )) as string[];

      return parseConsumeOutcome(result);
    });
  }

  async consumeChallengeAndMintGrant(
    input: ConsumeOtpChallengeAndMintGrantInput,
  ): Promise<ConsumeOtpChallengeAndMintGrantOutcome> {
    return this.withRedis(async (client) => {
      const nowUnixMs = Date.now();
      const grantExpiresAtUnixMs =
        input.grantCreatedAtUnixMs + input.grantTtlSeconds * 1000;

      const result = (await client.eval(
        OTP_CONSUME_AND_MINT_GRANT_LUA,
        3,
        otpChallengeKey(input.challengeId),
        otpConsumedKey(input.challengeId),
        otpVerificationGrantKey(input.grantId),
        input.codeDigest,
        String(nowUnixMs),
        OTP_REDIS_KEY_PREFIX,
        '300',
        input.grantId,
        String(otpRedisKeyTtlSeconds(input.grantTtlSeconds)),
        String(input.grantCreatedAtUnixMs),
        String(grantExpiresAtUnixMs),
      )) as string[];

      const outcome = parseConsumeOutcome(result);
      if (outcome.status !== 'matched') {
        return outcome;
      }
      return {
        status: 'matched',
        record: outcome.record,
        verificationGrantId: String(result[9]),
        grantExpiresAtUnixMs: Number(result[10]),
      };
    });
  }

  async deleteChallenge(challengeId: string, phone: string): Promise<void> {
    await this.withRedis(async (client) => {
      const phoneFingerprint = fingerprintSensitiveValue(phone);
      await client.eval(
        OTP_DELETE_CHALLENGE_LUA,
        2,
        otpChallengeKey(challengeId),
        otpPhoneActiveKey(phoneFingerprint),
        challengeId,
      );
    });
  }

  async incrementPhoneRequestCount(
    phone: string,
    window: OtpRateLimitWindow,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    return this.incrementWindow(
      otpPhoneWindowKey(
        fingerprintSensitiveValue(phone),
        otpWindowBucketId(Date.now(), window.windowSeconds),
      ),
      window,
    );
  }

  async incrementIpRequestCount(
    ipFingerprint: string,
    window: OtpRateLimitWindow,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    return this.incrementWindow(
      otpIpWindowKey(
        ipFingerprint,
        otpWindowBucketId(Date.now(), window.windowSeconds),
      ),
      window,
    );
  }

  private async incrementWindow(
    key: string,
    window: OtpRateLimitWindow,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    return this.withRedis(async (client) => {
      const result = (await client.eval(
        OTP_RATE_LIMIT_LUA,
        1,
        key,
        String(window.limit),
        String(window.windowSeconds),
      )) as [number, number, number];

      return {
        allowed: result[0] === 1,
        retryAfterSeconds: Math.max(1, Number(result[2])),
      };
    });
  }

  private async withRedis<T>(
    operation: (client: Redis) => Promise<T>,
  ): Promise<T> {
    const client = this.redis.getCommandClient();
    if (client === undefined) {
      throw new AuthError(
        AuthErrorCode.UNAVAILABLE,
        'OTP service is temporarily unavailable.',
      );
    }
    try {
      return await operation(client);
    } catch (error: unknown) {
      if (error instanceof AuthError) {
        throw error;
      }
      throw new AuthError(
        AuthErrorCode.UNAVAILABLE,
        'OTP service is temporarily unavailable.',
      );
    }
  }
}

function parseChallengeRecord(result: string[]): OtpChallengeRecord {
  return {
    challengeId: String(result[1]),
    phone: String(result[2]),
    purpose: String(result[3]) as OtpPurpose,
    codeDigest: String(result[4]),
    attempts: Number(result[5]),
    maxAttempts: Number(result[6]),
    createdAtUnixMs: Number(result[7]),
    expiresAtUnixMs: Number(result[8]),
  };
}

function parseConsumeOutcome(result: string[]): ConsumeOtpChallengeOutcome {
  const status = result[0];
  switch (status) {
    case 'matched':
      return {
        status: 'matched',
        record: parseChallengeRecord(result),
      };
    case 'mismatch':
      return {
        status: 'mismatch',
        attempts: Number(result[1]),
        remainingAttempts: Number(result[2]),
      };
    case 'locked':
      return { status: 'locked' };
    case 'missing':
      return { status: 'missing' };
    case 'expired':
      return { status: 'expired' };
    case 'already_used':
      return { status: 'already_used' };
    default:
      throw new AuthError(
        AuthErrorCode.UNAVAILABLE,
        'OTP challenge operation failed.',
      );
  }
}

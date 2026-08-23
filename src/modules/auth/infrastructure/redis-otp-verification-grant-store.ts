import { Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import type { OtpPurpose } from '../domain/otp-challenge';
import type {
  ConsumeOtpVerificationGrantOutcome,
  CreateOtpVerificationGrantInput,
  OtpVerificationGrantRecord,
  OtpVerificationGrantStore,
} from '../domain/otp-verification-grant';
import {
  OTP_CONSUME_VERIFICATION_GRANT_LUA,
  OTP_CREATE_VERIFICATION_GRANT_LUA,
} from './otp-lua-scripts';
import {
  otpVerificationGrantConsumedKey,
  otpVerificationGrantKey,
  otpRedisKeyTtlSeconds,
} from './otp-redis-keys';

/** Keep consumed markers long enough to defeat immediate replay after delete. */
const GRANT_CONSUMED_MARKER_TTL_SECONDS = 86_400;

@Injectable()
export class RedisOtpVerificationGrantStore implements OtpVerificationGrantStore {
  constructor(private readonly redis: RedisService) {}

  async createGrant(input: CreateOtpVerificationGrantInput): Promise<void> {
    await this.withRedis(async (client) => {
      const expiresAtUnixMs = input.createdAtUnixMs + input.ttlSeconds * 1000;
      await client.eval(
        OTP_CREATE_VERIFICATION_GRANT_LUA,
        1,
        otpVerificationGrantKey(input.grantId),
        input.grantId,
        input.phone,
        input.purpose,
        input.challengeId,
        String(input.createdAtUnixMs),
        String(expiresAtUnixMs),
        String(otpRedisKeyTtlSeconds(input.ttlSeconds)),
      );
    });
  }

  async consumeGrant(
    grantId: string,
  ): Promise<ConsumeOtpVerificationGrantOutcome> {
    return this.withRedis(async (client) => {
      const result = (await client.eval(
        OTP_CONSUME_VERIFICATION_GRANT_LUA,
        2,
        otpVerificationGrantKey(grantId),
        otpVerificationGrantConsumedKey(grantId),
        String(Date.now()),
        String(GRANT_CONSUMED_MARKER_TTL_SECONDS),
      )) as string[];

      const status = result[0];
      switch (status) {
        case 'matched':
          return {
            status: 'matched',
            record: parseGrantRecord(result),
          };
        case 'missing':
          return { status: 'missing' };
        case 'expired':
          return { status: 'expired' };
        case 'already_used':
          return { status: 'already_used' };
        default:
          throw new AuthError(
            AuthErrorCode.UNAVAILABLE,
            'OTP verification grant operation failed.',
          );
      }
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

function parseGrantRecord(result: string[]): OtpVerificationGrantRecord {
  return {
    grantId: String(result[1]),
    phone: String(result[2]),
    purpose: String(result[3]) as OtpPurpose,
    challengeId: String(result[4]),
    createdAtUnixMs: Number(result[5]),
    expiresAtUnixMs: Number(result[6]),
  };
}

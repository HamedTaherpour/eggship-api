import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import {
  ADMIN_LOGIN_ABUSE_KEY_PREFIX,
  ADMIN_LOGIN_EMAIL_WINDOW_LIMIT,
  ADMIN_LOGIN_EMAIL_WINDOW_SECONDS,
  ADMIN_LOGIN_IP_WINDOW_LIMIT,
  ADMIN_LOGIN_IP_WINDOW_SECONDS,
  type AdminLoginAbuseConsumeInput,
  type AdminLoginAbuseDecision,
  type AdminLoginAbuseLimiter,
} from '../domain/admin-login-abuse';
import { OTP_RATE_LIMIT_LUA } from './otp-lua-scripts';

type RedisEval = (
  script: string,
  numKeys: number,
  ...args: string[]
) => Promise<unknown>;

type WindowResult = [allowed: number, count: number, ttl: number];

/**
 * Admin login throttling. Redis when configured; in-process memory in
 * development/test so ordinary e2e stays network-independent. Production
 * without a ready Redis client fails closed.
 */
@Injectable()
export class AdminLoginAbuseLimiterService implements AdminLoginAbuseLimiter {
  private readonly nodeEnv: string;
  private readonly memory = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(
    private readonly redis: RedisService,
    private readonly logger: ApplicationLogger,
    config: ConfigService,
  ) {
    this.nodeEnv = config.getOrThrow<string>('NODE_ENV');
  }

  async consume(
    input: AdminLoginAbuseConsumeInput,
  ): Promise<AdminLoginAbuseDecision> {
    if (this.redis.isConfigured()) {
      return this.consumeRedis(input);
    }
    if (this.nodeEnv === 'production') {
      this.logger.error(
        {
          module: 'auth',
          operation: 'admin.auth.login.unavailable',
          reason: 'redis_unconfigured',
        },
        'Admin login throttling requires Redis in production',
      );
      throw new AuthError(
        AuthErrorCode.AUTH_UNAVAILABLE,
        'Authentication service is unavailable.',
      );
    }
    return this.consumeMemory(input);
  }

  private async consumeRedis(
    input: AdminLoginAbuseConsumeInput,
  ): Promise<AdminLoginAbuseDecision> {
    const client = this.redis.getCommandClient();
    if (client === undefined) {
      this.logger.error(
        {
          module: 'auth',
          operation: 'admin.auth.login.unavailable',
          reason: 'redis_not_ready',
        },
        'Admin login throttling Redis client is not ready',
      );
      throw new AuthError(
        AuthErrorCode.AUTH_UNAVAILABLE,
        'Authentication service is unavailable.',
      );
    }

    try {
      return await this.evaluateRedisWindows(client, input);
    } catch (error: unknown) {
      if (error instanceof AuthError) {
        throw error;
      }
      this.logger.error(
        {
          module: 'auth',
          operation: 'admin.auth.login.unavailable',
          reason: 'redis_eval_failed',
        },
        'Admin login throttling Redis command failed',
      );
      throw new AuthError(
        AuthErrorCode.AUTH_UNAVAILABLE,
        'Authentication service is unavailable.',
      );
    }
  }

  private async evaluateRedisWindows(
    client: { eval: RedisEval },
    input: AdminLoginAbuseConsumeInput,
  ): Promise<AdminLoginAbuseDecision> {
    const emailKey = `${ADMIN_LOGIN_ABUSE_KEY_PREFIX}:email:${input.emailFingerprint}`;
    const email = (await client.eval(
      OTP_RATE_LIMIT_LUA,
      1,
      emailKey,
      String(ADMIN_LOGIN_EMAIL_WINDOW_LIMIT),
      String(ADMIN_LOGIN_EMAIL_WINDOW_SECONDS),
    )) as WindowResult;

    if (Number(email[0]) === 0) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Number(email[2])),
      };
    }

    if (input.clientIp === undefined) {
      return { allowed: true };
    }

    const ipKey = `${ADMIN_LOGIN_ABUSE_KEY_PREFIX}:ip:${ipFingerprint(input.clientIp)}`;
    const ip = (await client.eval(
      OTP_RATE_LIMIT_LUA,
      1,
      ipKey,
      String(ADMIN_LOGIN_IP_WINDOW_LIMIT),
      String(ADMIN_LOGIN_IP_WINDOW_SECONDS),
    )) as WindowResult;

    if (Number(ip[0]) === 0) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Number(ip[2])) };
    }

    return { allowed: true };
  }

  private consumeMemory(
    input: AdminLoginAbuseConsumeInput,
  ): AdminLoginAbuseDecision {
    const now = Date.now();
    const emailDecision = this.hitMemory(
      `email:${input.emailFingerprint}`,
      now,
      ADMIN_LOGIN_EMAIL_WINDOW_LIMIT,
      ADMIN_LOGIN_EMAIL_WINDOW_SECONDS,
    );
    if (!emailDecision.allowed) {
      return emailDecision;
    }
    if (input.clientIp === undefined) {
      return { allowed: true };
    }
    return this.hitMemory(
      `ip:${input.clientIp}`,
      now,
      ADMIN_LOGIN_IP_WINDOW_LIMIT,
      ADMIN_LOGIN_IP_WINDOW_SECONDS,
    );
  }

  private hitMemory(
    key: string,
    now: number,
    limit: number,
    windowSeconds: number,
  ): AdminLoginAbuseDecision {
    const existing = this.memory.get(key);
    if (existing === undefined || existing.resetAt <= now) {
      this.memory.set(key, {
        count: 1,
        resetAt: now + windowSeconds * 1000,
      });
      return { allowed: true };
    }
    existing.count += 1;
    if (existing.count > limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((existing.resetAt - now) / 1000),
        ),
      };
    }
    return { allowed: true };
  }
}

function ipFingerprint(ip: string): string {
  return createHash('sha256').update(ip, 'utf8').digest('base64url');
}

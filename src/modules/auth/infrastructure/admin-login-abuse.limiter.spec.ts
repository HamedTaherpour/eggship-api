import type { ConfigService } from '@nestjs/config';
import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import type { RedisService } from '../../../infrastructure/redis/redis.service';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import { AdminLoginAbuseLimiterService } from './admin-login-abuse.limiter';

describe('AdminLoginAbuseLimiterService', () => {
  const logger: Pick<ApplicationLogger, 'error'> = {
    error: jest.fn(),
  };

  function createLimiter(input: {
    nodeEnv: string;
    redisConfigured: boolean;
    evalImpl?: () => Promise<unknown>;
    commandClient?: { eval: () => Promise<unknown> } | undefined;
  }): AdminLoginAbuseLimiterService {
    const redis = {
      isConfigured: (): boolean => input.redisConfigured,
      getCommandClient: () => {
        if (Object.prototype.hasOwnProperty.call(input, 'commandClient')) {
          return input.commandClient;
        }
        if (input.evalImpl === undefined) {
          return undefined;
        }
        return { eval: input.evalImpl };
      },
    } as unknown as RedisService;

    return new AdminLoginAbuseLimiterService(
      redis,
      logger as ApplicationLogger,
      {
        getOrThrow: (key: string): string => {
          if (key === 'NODE_ENV') {
            return input.nodeEnv;
          }
          throw new Error(key);
        },
      } as ConfigService,
    );
  }

  it('fails closed in production when Redis is unconfigured', async () => {
    const limiter = createLimiter({
      nodeEnv: 'production',
      redisConfigured: false,
    });

    await expect(
      limiter.consume({ emailFingerprint: 'fp' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.AUTH_UNAVAILABLE });
  });

  it('fails closed when Redis is configured but the command client is not ready', async () => {
    const limiter = createLimiter({
      nodeEnv: 'production',
      redisConfigured: true,
      commandClient: undefined,
    });

    await expect(
      limiter.consume({ emailFingerprint: 'fp' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.AUTH_UNAVAILABLE });
  });

  it('maps Redis eval failures to AUTH_UNAVAILABLE rather than an internal error', async () => {
    const limiter = createLimiter({
      nodeEnv: 'production',
      redisConfigured: true,
      evalImpl: (): Promise<unknown> => Promise.reject(new Error('timeout')),
    });

    await expect(
      limiter.consume({ emailFingerprint: 'fp' }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      limiter.consume({ emailFingerprint: 'fp' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.AUTH_UNAVAILABLE });
  });

  it('uses in-process memory in development and denies the sixth attempt', async () => {
    const limiter = createLimiter({
      nodeEnv: 'development',
      redisConfigured: false,
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        limiter.consume({ emailFingerprint: 'same' }),
      ).resolves.toEqual({ allowed: true });
    }

    await expect(
      limiter.consume({ emailFingerprint: 'same' }),
    ).resolves.toMatchObject({ allowed: false });
  });
});

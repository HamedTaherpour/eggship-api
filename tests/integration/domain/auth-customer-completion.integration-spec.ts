import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { LOG_DESTINATION } from '../../../src/common/observability/application-logger.service';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { RedisClientFactory } from '../../../src/infrastructure/redis/redis-client.factory';
import { RedisModule } from '../../../src/infrastructure/redis/redis.module';
import { AuthModule } from '../../../src/modules/auth/auth.module';
import { CustomerAuthCompletionService } from '../../../src/modules/auth/application/customer-auth-completion.service';
import { AuthError } from '../../../src/modules/auth/domain/auth-error';
import { AuthErrorCode } from '../../../src/modules/auth/domain/auth-error-codes';
import { OTP_PURPOSE_CUSTOMER_AUTH } from '../../../src/modules/auth/domain/otp-challenge';
import { AccessTokenService } from '../../../src/modules/auth/infrastructure/access-token.service';
import { AuthSessionRepository } from '../../../src/modules/auth/infrastructure/auth-session.repository';
import { OTP_REDIS_KEY_PREFIX } from '../../../src/modules/auth/infrastructure/otp-redis-keys';
import { RedisOtpVerificationGrantStore } from '../../../src/modules/auth/infrastructure/redis-otp-verification-grant-store';
import { UsersModule } from '../../../src/modules/users/users.module';
import { UserRepository } from '../../../src/modules/users/infrastructure/user.repository';
import { truncateAuthPersistenceTables } from '../support/truncate-auth-tables';
import { redisIntegrationKeyPrefix } from '../support/test-run-id';

function uniquePhone(suffix: number): string {
  const national = `912${String(suffix).padStart(7, '0')}`.slice(0, 10);
  return `+98${national}`;
}

/**
 * Real PostgreSQL + Redis domain integration for AUTH-07 completion.
 * Runs only under `pnpm test:integration` (suite=all).
 */
describe('Customer auth completion (PG+Redis integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let users: UserRepository;
  let sessions: AuthSessionRepository;
  let grants: RedisOtpVerificationGrantStore;
  let completion: CustomerAuthCompletionService;
  let accessTokens: AccessTokenService;
  let client: Redis;
  let keyPrefix: string;
  let phoneCounter = 0;

  beforeAll(async () => {
    const testRunId = process.env['EGGSHIP_TEST_RUN_ID'];
    if (testRunId === undefined || testRunId === '') {
      throw new Error('EGGSHIP_TEST_RUN_ID must be set by integration setup.');
    }
    keyPrefix = redisIntegrationKeyPrefix(testRunId);

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        RedisModule,
        UsersModule,
        AuthModule,
      ],
    })
      .overrideProvider(LOG_DESTINATION)
      .useValue(new PassThrough())
      .compile();

    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    users = moduleRef.get(UserRepository);
    sessions = moduleRef.get(AuthSessionRepository);
    grants = moduleRef.get(RedisOtpVerificationGrantStore);
    completion = moduleRef.get(CustomerAuthCompletionService);
    accessTokens = moduleRef.get(AccessTokenService);

    const factory = moduleRef.get(RedisClientFactory);
    const redisUrl = process.env['TEST_REDIS_URL'];
    if (redisUrl === undefined) {
      throw new Error(
        'TEST_REDIS_URL must be set for domain PG+Redis integration tests.',
      );
    }
    client = factory.createQueueClient(redisUrl);
    await app.init();
    await client.connect();
  });

  beforeEach(async () => {
    await truncateAuthPersistenceTables(prisma);
    const otpKeys = await client.keys(`${OTP_REDIS_KEY_PREFIX}:*`);
    if (otpKeys.length > 0) {
      await client.del(...otpKeys);
    }
  });

  afterAll(async () => {
    const otpKeys = await client.keys(`${OTP_REDIS_KEY_PREFIX}:*`);
    if (otpKeys.length > 0) {
      await client.del(...otpKeys);
    }
    const integrationKeys = await client.keys(`${keyPrefix}:*`);
    if (integrationKeys.length > 0) {
      await client.del(...integrationKeys);
    }
    if (client.status === 'ready') {
      await client.quit();
    } else {
      client.disconnect(false);
    }
    await app.close();
  });

  function nextPhone(): string {
    phoneCounter += 1;
    return uniquePhone(phoneCounter + (Date.now() % 1_000_000));
  }

  async function mintGrant(phone: string): Promise<string> {
    const grantId = randomUUID();
    await grants.createGrant({
      grantId,
      phone,
      purpose: OTP_PURPOSE_CUSTOMER_AUTH,
      challengeId: randomUUID(),
      ttlSeconds: 600,
      createdAtUnixMs: Date.now(),
    });
    return grantId;
  }

  it('creates a new User and AuthSession from a grant', async () => {
    const phone = nextPhone();
    const grantId = await mintGrant(phone);

    const result = await completion.completeAuthentication(grantId);

    expect(result.isNewUser).toBe(true);
    expect(result.user.phone).toBe(phone);
    const persistedUser = await users.findByPhone(phone);
    expect(persistedUser?.id).toBe(result.user.id);
    const session = await sessions.findSessionById(result.sessionId);
    expect(session).not.toBeNull();
    expect(session?.userId).toBe(result.user.id);

    const claims = await accessTokens.verifyAccessToken(result.accessToken);
    expect(claims.subjectId).toBe(result.user.id);
    expect(claims.sessionId).toBe(result.sessionId);

    await expect(
      completion.completeAuthentication(grantId),
    ).rejects.toMatchObject({
      code: AuthErrorCode.VERIFICATION_GRANT_USED,
    });
  });

  it('authenticates an existing user and keeps prior sessions', async () => {
    const phone = nextPhone();
    const existing = await users.create({ phone });
    const prior = await sessions.createSession({
      userId: existing.id,
      refreshTokenHash: `${'b'.repeat(43)}`,
      tokenFamilyId: randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const grantId = await mintGrant(phone);
    const result = await completion.completeAuthentication(grantId);

    expect(result.isNewUser).toBe(false);
    expect(result.user.id).toBe(existing.id);
    const priorAfter = await sessions.findSessionById(prior.id);
    expect(priorAfter?.revokedAt).toBeNull();
    const newSession = await sessions.findSessionById(result.sessionId);
    expect(newSession?.userId).toBe(existing.id);
  });

  it('rejects inactive accounts after grant consume', async () => {
    const phone = nextPhone();
    await users.create({ phone, isActive: false });
    const grantId = await mintGrant(phone);

    await expect(
      completion.completeAuthentication(grantId),
    ).rejects.toMatchObject({
      code: AuthErrorCode.ACCOUNT_DISABLED,
    });

    await expect(
      completion.completeAuthentication(grantId),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('creates exactly one User under concurrent same-phone registration', async () => {
    const phone = nextPhone();
    const grantA = await mintGrant(phone);
    const grantB = await mintGrant(phone);

    const outcomes = await Promise.allSettled([
      completion.completeAuthentication(grantA),
      completion.completeAuthentication(grantB),
    ]);

    const fulfilled = outcomes.filter(
      (
        outcome,
      ): outcome is PromiseFulfilledResult<
        Awaited<
          ReturnType<CustomerAuthCompletionService['completeAuthentication']>
        >
      > => outcome.status === 'fulfilled',
    );
    expect(fulfilled).toHaveLength(2);
    expect(fulfilled[0]?.value.user.id).toBe(fulfilled[1]?.value.user.id);
    const newUserFlags = fulfilled.map((outcome) => outcome.value.isNewUser);
    expect(newUserFlags.filter(Boolean)).toHaveLength(1);

    const rows = await prisma.user.findMany({ where: { phone } });
    expect(rows).toHaveLength(1);

    const sessionCount = await prisma.authSession.count({
      where: { userId: rows[0]!.id },
    });
    expect(sessionCount).toBe(2);
  });

  it('allows only one completion among 20 concurrent same-grant requests', async () => {
    const phone = nextPhone();
    const grantId = await mintGrant(phone);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        completion.completeAuthentication(grantId),
      ),
    );

    const succeeded = outcomes.filter(
      (outcome) => outcome.status === 'fulfilled',
    );
    const rejected = outcomes.filter(
      (outcome) => outcome.status === 'rejected',
    );

    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(19);

    for (const outcome of rejected) {
      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toBeInstanceOf(AuthError);
        expect((outcome.reason as AuthError).code).toBe(
          AuthErrorCode.VERIFICATION_GRANT_USED,
        );
      }
    }

    const sessionCount = await prisma.authSession.count({
      where: {
        userId: (
          succeeded[0] as PromiseFulfilledResult<{ user: { id: string } }>
        ).value.user.id,
      },
    });
    expect(sessionCount).toBe(1);
  });
});

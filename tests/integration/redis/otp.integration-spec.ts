import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { LOG_DESTINATION } from '../../../src/common/observability/application-logger.service';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { RedisClientFactory } from '../../../src/infrastructure/redis/redis-client.factory';
import { RedisModule } from '../../../src/infrastructure/redis/redis.module';
import { RedisService } from '../../../src/infrastructure/redis/redis.service';
import { OTP_PURPOSE_CUSTOMER_AUTH } from '../../../src/modules/auth/domain/otp-challenge';
import { digestOtpCode } from '../../../src/modules/auth/domain/otp-digest';
import {
  fingerprintSensitiveValue,
  otpChallengeKey,
  otpPhoneActiveKey,
  otpPhoneCooldownKey,
  otpPhoneWindowKey,
  otpVerificationGrantConsumedKey,
  otpVerificationGrantKey,
  otpWindowBucketId,
} from '../../../src/modules/auth/infrastructure/otp-redis-keys';
import { otpConsumedKey } from '../../../src/modules/auth/infrastructure/otp-lua-scripts';
import { RedisOtpStore } from '../../../src/modules/auth/infrastructure/redis-otp-store';
import { redisIntegrationKeyPrefix } from '../support/test-run-id';

describe('Redis OTP store (integration)', () => {
  let app: INestApplicationContext;
  let store: RedisOtpStore;
  let client: Redis;
  let keyPrefix: string;
  const ownedKeys = new Set<string>();
  const hashSecret = 'integration-otp-hash-secret-32chars-min';

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
      ],
      providers: [RedisOtpStore],
    })
      .overrideProvider(LOG_DESTINATION)
      .useValue(new PassThrough())
      .compile();

    app = moduleRef;
    store = moduleRef.get(RedisOtpStore);
    const factory = moduleRef.get(RedisClientFactory);
    const redisUrl = process.env['TEST_REDIS_URL'];
    if (redisUrl === undefined) {
      throw new Error(
        'TEST_REDIS_URL must be set for Redis integration tests.',
      );
    }
    client = factory.createQueueClient(redisUrl);
    await app.init();
    await client.connect();
  });

  afterAll(async () => {
    await deleteOwnedKeys();
    if (client.status === 'ready') {
      await client.quit();
    } else {
      client.disconnect(false);
    }
    await app.close();
  });

  afterEach(async () => {
    await deleteOwnedKeys();
  });

  async function deleteOwnedKeys(): Promise<void> {
    if (ownedKeys.size > 0) {
      await client.del(...ownedKeys);
      ownedKeys.clear();
    }
  }

  function trackChallenge(challengeId: string, phone: string): void {
    const phoneFingerprint = fingerprintSensitiveValue(phone);
    ownedKeys.add(otpChallengeKey(challengeId));
    ownedKeys.add(otpConsumedKey(challengeId));
    ownedKeys.add(otpPhoneActiveKey(phoneFingerprint));
    ownedKeys.add(otpPhoneCooldownKey(phoneFingerprint));
  }

  function trackGrant(grantId: string): void {
    ownedKeys.add(otpVerificationGrantKey(grantId));
    ownedKeys.add(otpVerificationGrantConsumedKey(grantId));
  }

  function trackPhoneWindow(phone: string, windowSeconds: number): void {
    ownedKeys.add(
      otpPhoneWindowKey(
        fingerprintSensitiveValue(phone),
        otpWindowBucketId(Date.now(), windowSeconds),
      ),
    );
  }

  async function createChallenge(options?: {
    phone?: string;
    code?: string;
    ttlSeconds?: number;
    maxAttempts?: number;
    cooldownSeconds?: number;
  }): Promise<{ challengeId: string; code: string; phone: string }> {
    const challengeId = randomUUID();
    const phone = options?.phone ?? `+98912${String(Date.now()).slice(-7)}`;
    const code = options?.code ?? '482913';
    trackChallenge(challengeId, phone);
    const created = await store.createChallenge({
      challengeId,
      phone,
      purpose: OTP_PURPOSE_CUSTOMER_AUTH,
      codeDigest: digestOtpCode(code, hashSecret),
      maxAttempts: options?.maxAttempts ?? 5,
      ttlSeconds: options?.ttlSeconds ?? 120,
      resendCooldownSeconds: options?.cooldownSeconds ?? 30,
      createdAtUnixMs: Date.now(),
    });
    expect(created.status).toBe('created');
    return { challengeId, code, phone };
  }

  it('expires challenges after TTL', async () => {
    const { challengeId, code } = await createChallenge({ ttlSeconds: 1 });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const outcome = await store.consumeChallenge({
      challengeId,
      codeDigest: digestOtpCode(code, hashSecret),
    });
    expect(outcome.status).toBe('expired');
  });

  it('consumes a correct OTP exactly once', async () => {
    const { challengeId, code } = await createChallenge();
    const first = await store.consumeChallenge({
      challengeId,
      codeDigest: digestOtpCode(code, hashSecret),
    });
    expect(first.status).toBe('matched');
    const second = await store.consumeChallenge({
      challengeId,
      codeDigest: digestOtpCode(code, hashSecret),
    });
    expect(second.status).toBe('already_used');
  });

  it('allows only one success among 20 concurrent correct verifies', async () => {
    const { challengeId, code } = await createChallenge();
    const digest = digestOtpCode(code, hashSecret);
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        store.consumeChallenge({ challengeId, codeDigest: digest }),
      ),
    );
    expect(results.filter((r) => r.status === 'matched')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'matched').length).toBe(1);
    expect(
      results.filter(
        (r) => r.status === 'already_used' || r.status === 'missing',
      ).length,
    ).toBe(19);
  });

  it('atomically mints exactly one grant among 20 concurrent verify+mint calls', async () => {
    const { challengeId, code } = await createChallenge();
    const digest = digestOtpCode(code, hashSecret);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => {
        const grantId = randomUUID();
        trackGrant(grantId);
        return store.consumeChallengeAndMintGrant({
          challengeId,
          codeDigest: digest,
          grantId,
          grantTtlSeconds: 120,
          grantCreatedAtUnixMs: Date.now() + index,
        });
      }),
    );
    const matched = results.filter((r) => r.status === 'matched');
    expect(matched).toHaveLength(1);
    if (matched[0]?.status === 'matched') {
      expect(matched[0].verificationGrantId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
      );
    }
    expect(
      results.filter(
        (r) => r.status === 'already_used' || r.status === 'missing',
      ),
    ).toHaveLength(19);
  });

  it('increments wrong attempts atomically and locks at max', async () => {
    const { challengeId } = await createChallenge({ maxAttempts: 3 });
    const wrong = digestOtpCode('000000', hashSecret);
    expect(
      (await store.consumeChallenge({ challengeId, codeDigest: wrong })).status,
    ).toBe('mismatch');
    expect(
      (await store.consumeChallenge({ challengeId, codeDigest: wrong })).status,
    ).toBe('mismatch');
    expect(
      (await store.consumeChallenge({ challengeId, codeDigest: wrong })).status,
    ).toBe('locked');
    expect(await client.exists(otpChallengeKey(challengeId))).toBe(0);
  });

  it('enforces resend cooldown for the same phone', async () => {
    const phone = '+989121111111';
    await createChallenge({ phone, cooldownSeconds: 60 });
    const secondId = randomUUID();
    trackChallenge(secondId, phone);
    const second = await store.createChallenge({
      challengeId: secondId,
      phone,
      purpose: OTP_PURPOSE_CUSTOMER_AUTH,
      codeDigest: digestOtpCode('111111', hashSecret),
      maxAttempts: 5,
      ttlSeconds: 120,
      resendCooldownSeconds: 60,
      createdAtUnixMs: Date.now(),
    });
    expect(second).toMatchObject({ status: 'cooldown' });
  });

  it('enforces phone request windows', async () => {
    const phone = '+989122222222';
    for (let i = 0; i < 5; i += 1) {
      trackPhoneWindow(phone, 3600);
      const result = await store.incrementPhoneRequestCount(phone, {
        limit: 5,
        windowSeconds: 3600,
      });
      expect(result.allowed).toBe(true);
    }
    trackPhoneWindow(phone, 3600);
    const blocked = await store.incrementPhoneRequestCount(phone, {
      limit: 5,
      windowSeconds: 3600,
    });
    expect(blocked.allowed).toBe(false);
  });

  it('serializes concurrent createChallenge for the same phone to one success', async () => {
    const phone = '+989123333333';
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) => {
        const challengeId = randomUUID();
        trackChallenge(challengeId, phone);
        return store.createChallenge({
          challengeId,
          phone,
          purpose: OTP_PURPOSE_CUSTOMER_AUTH,
          codeDigest: digestOtpCode(String(100000 + index), hashSecret),
          maxAttempts: 5,
          ttlSeconds: 120,
          resendCooldownSeconds: 60,
          createdAtUnixMs: Date.now(),
        });
      }),
    );
    expect(results.filter((r) => r.status === 'created')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'cooldown')).toHaveLength(9);
  });

  it('cleans up OTP challenge keys without flushing unrelated namespaces', async () => {
    const sentinel = `${keyPrefix}:bullmq-sentinel`;
    ownedKeys.add(sentinel);
    await client.set(sentinel, '1', 'EX', 60);
    const phone = '+989124444444';
    const id = randomUUID();
    trackChallenge(id, phone);
    await store.createChallenge({
      challengeId: id,
      phone,
      purpose: OTP_PURPOSE_CUSTOMER_AUTH,
      codeDigest: digestOtpCode('555555', hashSecret),
      maxAttempts: 5,
      ttlSeconds: 120,
      resendCooldownSeconds: 1,
      createdAtUnixMs: Date.now(),
    });
    await store.deleteChallenge(id, phone);
    expect(await client.exists(otpChallengeKey(id))).toBe(0);
    expect(await client.get(sentinel)).toBe('1');
  });

  it('uses RedisService command client (real Redis contacted)', async () => {
    const redisService = app.get(RedisService);
    expect(redisService.getCommandClient()).toBeDefined();
    await expect(redisService.readiness()).resolves.toEqual({
      configured: true,
      ready: true,
    });
  });
});

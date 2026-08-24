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
import { OTP_PURPOSE_CUSTOMER_AUTH } from '../../../src/modules/auth/domain/otp-challenge';
import {
  otpVerificationGrantConsumedKey,
  otpVerificationGrantKey,
} from '../../../src/modules/auth/infrastructure/otp-redis-keys';
import { RedisOtpVerificationGrantStore } from '../../../src/modules/auth/infrastructure/redis-otp-verification-grant-store';

describe('Redis OTP verification grant store (integration)', () => {
  let app: INestApplicationContext;
  let store: RedisOtpVerificationGrantStore;
  let client: Redis;
  const ownedKeys = new Set<string>();

  beforeAll(async () => {
    const testRunId = process.env['EGGSHIP_TEST_RUN_ID'];
    if (testRunId === undefined || testRunId === '') {
      throw new Error('EGGSHIP_TEST_RUN_ID must be set by integration setup.');
    }
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        RedisModule,
      ],
      providers: [RedisOtpVerificationGrantStore],
    })
      .overrideProvider(LOG_DESTINATION)
      .useValue(new PassThrough())
      .compile();

    app = moduleRef;
    store = moduleRef.get(RedisOtpVerificationGrantStore);
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

  function trackGrant(grantId: string): void {
    ownedKeys.add(otpVerificationGrantKey(grantId));
    ownedKeys.add(otpVerificationGrantConsumedKey(grantId));
  }

  it('creates a grant bound to phone/purpose and consumes it once', async () => {
    const grantId = randomUUID();
    trackGrant(grantId);
    const challengeId = randomUUID();
    await store.createGrant({
      grantId,
      phone: '+989121234567',
      purpose: OTP_PURPOSE_CUSTOMER_AUTH,
      challengeId,
      ttlSeconds: 120,
      createdAtUnixMs: Date.now(),
    });

    expect(await client.exists(otpVerificationGrantKey(grantId))).toBe(1);

    const first = await store.consumeGrant(grantId);
    expect(first).toMatchObject({
      status: 'matched',
      record: {
        grantId,
        phone: '+989121234567',
        purpose: OTP_PURPOSE_CUSTOMER_AUTH,
        challengeId,
      },
    });

    const second = await store.consumeGrant(grantId);
    expect(second.status).toBe('already_used');
    expect(await client.exists(otpVerificationGrantKey(grantId))).toBe(0);
  });

  it('allows only one success among 20 concurrent grant consumes', async () => {
    const grantId = randomUUID();
    trackGrant(grantId);
    await store.createGrant({
      grantId,
      phone: '+989129999999',
      purpose: OTP_PURPOSE_CUSTOMER_AUTH,
      challengeId: randomUUID(),
      ttlSeconds: 120,
      createdAtUnixMs: Date.now(),
    });

    const results = await Promise.all(
      Array.from({ length: 20 }, () => store.consumeGrant(grantId)),
    );
    expect(results.filter((r) => r.status === 'matched')).toHaveLength(1);
    expect(
      results.filter(
        (r) => r.status === 'already_used' || r.status === 'missing',
      ),
    ).toHaveLength(19);
  });

  it('rejects expired grants', async () => {
    const grantId = randomUUID();
    trackGrant(grantId);
    await store.createGrant({
      grantId,
      phone: '+989128888888',
      purpose: OTP_PURPOSE_CUSTOMER_AUTH,
      challengeId: randomUUID(),
      ttlSeconds: 1,
      createdAtUnixMs: Date.now(),
    });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const outcome = await store.consumeGrant(grantId);
    expect(outcome.status).toBe('expired');
  });

  it('rejects unknown grant ids as missing (not forgeable)', async () => {
    const outcome = await store.consumeGrant(randomUUID());
    expect(outcome.status).toBe('missing');
  });
});

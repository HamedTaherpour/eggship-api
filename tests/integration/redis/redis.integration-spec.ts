import { PassThrough } from 'node:stream';
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
import { redisIntegrationKeyPrefix } from '../support/test-run-id';

describe('Redis infrastructure (integration)', () => {
  let app: INestApplicationContext;
  let redisService: RedisService;
  let client: Redis;
  let keyPrefix: string;

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
    })
      .overrideProvider(LOG_DESTINATION)
      .useValue(new PassThrough())
      .compile();

    app = moduleRef;
    redisService = moduleRef.get(RedisService);
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
    const keys = await client.keys(`${keyPrefix}:*`);
    if (keys.length > 0) {
      await client.del(...keys);
    }
    if (client.status === 'ready') {
      await client.quit();
    } else {
      client.disconnect(false);
    }
    await app.close();
  });

  it('connects through RedisService and responds to ping', async () => {
    expect(redisService.isConfigured()).toBe(true);
    await expect(redisService.readiness()).resolves.toEqual({
      configured: true,
      ready: true,
    });
  });

  it('sets and gets a namespaced key with TTL, then cleans up', async () => {
    const key = `${keyPrefix}:probe`;
    const value = `value-${keyPrefix}`;

    await client.set(key, value, 'EX', 60);
    await expect(client.get(key)).resolves.toBe(value);
    const ttl = await client.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);

    await client.del(key);
    await expect(client.get(key)).resolves.toBeNull();
  });
});

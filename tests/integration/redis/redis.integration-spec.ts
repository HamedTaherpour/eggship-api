import { PassThrough } from 'node:stream';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import {
  ApplicationLogger,
  LOG_DESTINATION,
} from '../../../src/common/observability/application-logger.service';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { RedisClientFactory } from '../../../src/infrastructure/redis/redis-client.factory';
import { RedisModule } from '../../../src/infrastructure/redis/redis.module';
import { RedisService } from '../../../src/infrastructure/redis/redis.service';
import { redisIntegrationKeyPrefix } from '../support/test-run-id';

describe('Redis infrastructure (integration)', () => {
  let app: INestApplicationContext;
  let redisService: RedisService;
  let factory: RedisClientFactory;
  let client: Redis;
  let keyPrefix: string;
  let redisUrl: string;

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
    factory = moduleRef.get(RedisClientFactory);
    const configuredUrl = process.env['TEST_REDIS_URL'];
    if (configuredUrl === undefined) {
      throw new Error(
        'TEST_REDIS_URL must be set for Redis integration tests.',
      );
    }
    redisUrl = configuredUrl;
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
    const commandClient = redisService.getCommandClient();
    expect(commandClient).toBeDefined();
    await expect(commandClient!.ping()).resolves.toBe('PONG');
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

  it('creates distinct lifecycle, queue, and worker clients', () => {
    const lifecycle = factory.createLifecycleClient(redisUrl);
    const queueClient = factory.createQueueClient(redisUrl);
    const workerClient = factory.createWorkerClient(redisUrl);

    expect(lifecycle).not.toBe(queueClient);
    expect(queueClient).not.toBe(workerClient);
    expect(lifecycle.options.maxRetriesPerRequest).toBe(1);
    expect(queueClient.options.maxRetriesPerRequest).toBe(1);
    expect(workerClient.options.maxRetriesPerRequest).toBeNull();

    lifecycle.disconnect(false);
    queueClient.disconnect(false);
    workerClient.disconnect(false);
  });

  it('keeps configured API Redis degraded when unavailable and does not invent a fallback client', async () => {
    const unavailableUrl = 'redis://127.0.0.1:1';
    const failing = new RedisService(
      new ConfigService({ REDIS_URL: unavailableUrl }),
      app.get(ApplicationLogger),
      factory,
    );

    await expect(failing.onModuleInit()).resolves.toBeUndefined();
    expect(failing.isConfigured()).toBe(true);
    expect(failing.getCommandClient()).toBeUndefined();
    await expect(failing.readiness()).resolves.toEqual({
      configured: true,
      ready: false,
    });
  });
});

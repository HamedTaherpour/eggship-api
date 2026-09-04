import { PassThrough } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { ApplicationLogger } from '../../common/observability/application-logger.service';
import { RequestContextService } from '../../common/observability/request-context.service';
import { RedisClientFactory } from './redis-client.factory';
import { RedisService } from './redis.service';

class TestRedisClient {
  status = 'wait';
  connectCalls = 0;
  quitCalls = 0;
  disconnectCalls = 0;
  private readonly errorListeners: Array<(error: Error) => void> = [];

  constructor(private readonly connectError?: Error) {}

  connect(): Promise<void> {
    this.connectCalls += 1;
    if (this.connectError !== undefined) {
      return Promise.reject(this.connectError);
    }
    this.status = 'ready';
    return Promise.resolve();
  }

  ping(): Promise<string> {
    return Promise.resolve('PONG');
  }

  quit(): Promise<string> {
    this.quitCalls += 1;
    this.status = 'end';
    return Promise.resolve('OK');
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    this.status = 'end';
  }

  on(event: string, listener: (error: Error) => void): this {
    if (event === 'error') this.errorListeners.push(listener);
    return this;
  }

  drop(): void {
    this.status = 'end';
    for (const listener of this.errorListeners) listener(new Error('dropped'));
  }

  recover(): void {
    this.status = 'ready';
  }
}

class TestRedisClientFactory extends RedisClientFactory {
  createCalls = 0;

  constructor(private readonly client: TestRedisClient) {
    super();
  }

  override createLifecycleClient(): Redis {
    this.createCalls += 1;
    return this.client as unknown as Redis;
  }
}

describe('RedisService', () => {
  it('stays disabled without constructing a client when REDIS_URL is absent', async () => {
    const client = new TestRedisClient();
    const factory = new TestRedisClientFactory(client);
    const { logger, output } = createLogger();
    const service = new RedisService(new ConfigService(), logger, factory);

    await service.onModuleInit();

    expect(factory.createCalls).toBe(0);
    expect(service.getCommandClient()).toBeUndefined();
    await expect(service.readiness()).resolves.toEqual({
      configured: false,
      ready: false,
    });
    expect(output()).toContain('Redis infrastructure is disabled');
  });

  it('connects, reports readiness, and closes configured Redis gracefully', async () => {
    const client = new TestRedisClient();
    const factory = new TestRedisClientFactory(client);
    const { logger } = createLogger();
    const service = new RedisService(
      new ConfigService({ REDIS_URL: 'redis://example.invalid:6379' }),
      logger,
      factory,
    );

    await service.onModuleInit();

    expect(service.getCommandClient()).toBe(client);
    await expect(service.readiness()).resolves.toEqual({
      configured: true,
      ready: true,
    });
    await service.onModuleDestroy();
    expect(client.connectCalls).toBe(1);
    expect(client.quitCalls).toBe(1);
    expect(service.getCommandClient()).toBeUndefined();
  });

  it('starts degraded without logging Redis credentials when Redis is unavailable', async () => {
    const client = new TestRedisClient(new Error('connection refused'));
    const factory = new TestRedisClientFactory(client);
    const { logger, output } = createLogger();
    const redisUrl = 'redis://user:private-password@example.invalid:6379';
    const service = new RedisService(
      new ConfigService({ REDIS_URL: redisUrl }),
      logger,
      factory,
    );

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(client.disconnectCalls).toBe(0);
    expect(output()).toContain('Redis connection unavailable');
    expect(output()).not.toContain(redisUrl);
    expect(output()).not.toContain('private-password');
    await expect(service.readiness()).resolves.toEqual({
      configured: true,
      ready: false,
    });
  });

  it('derives readiness from the lifecycle client after disconnect and recovery', async () => {
    const client = new TestRedisClient();
    const factory = new TestRedisClientFactory(client);
    const { logger } = createLogger();
    const service = new RedisService(
      new ConfigService({ REDIS_URL: 'redis://example.invalid:6379' }),
      logger,
      factory,
    );

    await service.onModuleInit();
    client.drop();
    await expect(service.readiness()).resolves.toEqual({
      configured: true,
      ready: false,
    });
    client.recover();
    await expect(service.readiness()).resolves.toEqual({
      configured: true,
      ready: true,
    });
  });
});

function createLogger(): { logger: ApplicationLogger; output: () => string } {
  const destination = new PassThrough();
  let logOutput = '';
  destination.on('data', (chunk: Buffer) => {
    logOutput += chunk.toString('utf8');
  });
  const logger = new ApplicationLogger(
    new ConfigService({
      NODE_ENV: 'test',
      APP_VERSION: '0.1.0-test',
      GIT_SHA: 'test',
    }),
    new RequestContextService(),
    destination,
  );
  return { logger, output: () => logOutput };
}

import { PassThrough } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import { ApplicationLogger } from '../../common/observability/application-logger.service';
import { RequestContextService } from '../../common/observability/request-context.service';
import { RedisClientFactory } from '../redis/redis-client.factory';
import { QueueFactory } from './queue.factory';

describe('QueueFactory', () => {
  it('rejects queue construction when Redis is disabled', () => {
    const logger = new ApplicationLogger(
      new ConfigService({
        NODE_ENV: 'test',
        APP_VERSION: '0.1.0-test',
        GIT_SHA: 'test',
      }),
      new RequestContextService(),
      new PassThrough(),
    );
    const factory = new QueueFactory(
      new ConfigService(),
      new RedisClientFactory(),
      logger,
    );

    expect(() => factory.create('unconfigured')).toThrow(
      'Cannot create a queue when REDIS_URL is not configured.',
    );
  });

  it('rejects queue names that contain colon separators', () => {
    const logger = new ApplicationLogger(
      new ConfigService({
        NODE_ENV: 'test',
        APP_VERSION: '0.1.0-test',
        GIT_SHA: 'test',
      }),
      new RequestContextService(),
      new PassThrough(),
    );
    const factory = new QueueFactory(
      new ConfigService({ REDIS_URL: 'redis://127.0.0.1:6379' }),
      new RedisClientFactory(),
      logger,
    );

    expect(() => factory.create('eggship:bad')).toThrow(
      'Queue name cannot contain ":"',
    );
  });
});

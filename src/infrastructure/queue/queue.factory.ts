import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { DefaultJobOptions } from 'bullmq';
import type Redis from 'ioredis';
import { ApplicationLogger } from '../../common/observability/application-logger.service';
import { RedisClientFactory } from '../redis/redis-client.factory';
import type { AsyncJobEnvelope } from './async-job-context.service';
import { buildDefaultJobOptions } from './queue-options';

@Injectable()
export class QueueFactory implements OnModuleDestroy {
  private readonly resources: Array<{ queue: Queue; connection: Redis }> = [];

  constructor(
    private readonly config: ConfigService,
    private readonly redisClientFactory: RedisClientFactory,
    private readonly logger: ApplicationLogger,
  ) {}

  create<Data, Result = void, Name extends string = string>(
    queueName: string,
    overrides: DefaultJobOptions = {},
  ): Queue<AsyncJobEnvelope<Data>, Result, Name> {
    const url = this.config.get<string>('REDIS_URL');
    if (url === undefined) {
      throw new Error(
        'Cannot create a queue when REDIS_URL is not configured.',
      );
    }
    const connection = this.redisClientFactory.createQueueClient(url);
    const queue = new Queue<AsyncJobEnvelope<Data>, Result, Name>(queueName, {
      connection,
      defaultJobOptions: buildDefaultJobOptions(overrides),
    });
    queue.on('error', (error) => {
      this.logger.error(
        { module: 'queue', operation: 'queue_error', queueName },
        'Queue infrastructure error',
        error,
      );
    });
    this.resources.push({ queue, connection });
    return queue;
  }

  async onModuleDestroy(): Promise<void> {
    for (const resource of this.resources) {
      await resource.queue.close();
      if (resource.connection.status === 'ready') {
        await resource.connection.quit();
      } else {
        resource.connection.disconnect(false);
      }
    }
  }
}

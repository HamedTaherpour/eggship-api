import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import type { RedisOptions } from 'ioredis';

@Injectable()
export class RedisClientFactory {
  createLifecycleClient(url: string): Redis {
    return new Redis(url, this.options({ maxRetriesPerRequest: 1 }));
  }

  createQueueClient(url: string): Redis {
    return new Redis(url, this.options({ maxRetriesPerRequest: 1 }));
  }

  createWorkerClient(url: string): Redis {
    return new Redis(url, this.options({ maxRetriesPerRequest: null }));
  }

  private options(overrides: RedisOptions): RedisOptions {
    return {
      lazyConnect: true,
      enableReadyCheck: true,
      connectTimeout: 5_000,
      retryStrategy: (attempt) =>
        attempt <= 3 ? Math.min(attempt * 200, 1_000) : null,
      ...overrides,
    };
  }
}

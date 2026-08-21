import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { ApplicationLogger } from '../../common/observability/application-logger.service';
import { RedisClientFactory } from './redis-client.factory';

export interface RedisReadiness {
  configured: boolean;
  ready: boolean;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: ApplicationLogger,
    private readonly clientFactory: RedisClientFactory,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>('REDIS_URL');
    if (url === undefined) {
      this.logger.info(
        { module: 'redis', operation: 'bootstrap', enabled: false },
        'Redis infrastructure is disabled',
      );
      return;
    }

    this.client = this.clientFactory.createLifecycleClient(url);
    try {
      await this.client.connect();
      this.logger.info(
        { module: 'redis', operation: 'connect', enabled: true },
        'Redis connection established',
      );
    } catch (error: unknown) {
      this.client.disconnect(false);
      this.client = undefined;
      const connectionError =
        error instanceof Error ? error : new Error('Redis connection failed.');
      this.logger.error(
        { module: 'redis', operation: 'connect' },
        'Redis connection failed',
        connectionError,
      );
      throw connectionError;
    }
  }

  isConfigured(): boolean {
    return this.config.get<string>('REDIS_URL') !== undefined;
  }

  /**
   * Returns the connected Redis command client, or undefined when Redis is
   * disabled or not ready. OTP and other Redis-backed capabilities must fail
   * closed when this is undefined—never fall back to in-memory state.
   */
  getCommandClient(): Redis | undefined {
    if (this.client === undefined || this.client.status !== 'ready') {
      return undefined;
    }
    return this.client;
  }

  async readiness(): Promise<RedisReadiness> {
    if (this.client === undefined) {
      return { configured: false, ready: false };
    }
    if (this.client.status !== 'ready') {
      return { configured: true, ready: false };
    }
    try {
      return {
        configured: true,
        ready: (await this.client.ping()) === 'PONG',
      };
    } catch {
      this.logger.warn(
        { module: 'redis', operation: 'readiness' },
        'Redis readiness check failed',
      );
      return { configured: true, ready: false };
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client === undefined) {
      return;
    }
    try {
      if (this.client.status === 'ready') {
        await this.client.quit();
      } else {
        this.client.disconnect(false);
      }
    } catch {
      this.client.disconnect(false);
      this.logger.warn(
        { module: 'redis', operation: 'disconnect' },
        'Redis connection required forced shutdown',
      );
    } finally {
      this.client = undefined;
    }
  }
}

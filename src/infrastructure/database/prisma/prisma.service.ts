import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';

function createAdapter(config: ConfigService): PrismaPg {
  return new PrismaPg({
    connectionString: config.getOrThrow<string>('DATABASE_URL'),
    max: config.getOrThrow<number>('DATABASE_POOL_MAX'),
    connectionTimeoutMillis: config.getOrThrow<number>(
      'DATABASE_CONNECTION_TIMEOUT_MS',
    ),
    idleTimeoutMillis: config.getOrThrow<number>('DATABASE_IDLE_TIMEOUT_MS'),
  });
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    super({ adapter: createAdapter(config) });
  }

  async onModuleInit(): Promise<void> {
    // Prisma connects lazily. Readiness owns the dependency check so the API
    // can remain live while truthfully returning not_ready during DB outage.
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';

function createAdapter(config: ConfigService): PrismaPg {
  // pg defaults to max=10. Order/inventory integration stampedes (and real
  // identical-create races) hold one connection per waiter on advisory locks;
  // undersized pools surface as "timeout exceeded when trying to connect".
  return new PrismaPg({
    connectionString: config.getOrThrow<string>('DATABASE_URL'),
    max: 32,
    connectionTimeoutMillis: 60_000,
    idleTimeoutMillis: 300_000,
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
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

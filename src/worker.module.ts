import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createWorkerConfigModuleOptions } from './config/worker-config-module.options';
import { ObservabilityModule } from './common/observability/observability.module';
import { QueueInfrastructureModule } from './infrastructure/queue/queue-infrastructure.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { WorkerModule } from './infrastructure/worker/worker.module';

@Module({
  imports: [
    ConfigModule.forRoot(createWorkerConfigModuleOptions()),
    ObservabilityModule,
    RedisModule,
    QueueInfrastructureModule,
    WorkerModule.register(),
  ],
})
export class WorkerAppModule {}

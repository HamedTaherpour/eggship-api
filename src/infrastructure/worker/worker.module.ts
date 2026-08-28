import { DynamicModule, Module } from '@nestjs/common';
import type { InjectionToken, Provider } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ObservabilityModule } from '../../common/observability/observability.module';
import { QueueInfrastructureModule } from '../queue/queue-infrastructure.module';
import { RedisModule } from '../redis/redis.module';
import { WORKER_PROCESSORS } from './worker.tokens';
import { WorkerService } from './worker.service';
import type { WorkerProcessor } from './worker.types';

@Module({
  imports: [
    ConfigModule,
    ObservabilityModule,
    RedisModule,
    QueueInfrastructureModule,
  ],
  providers: [WorkerService],
  exports: [WorkerService],
})
export class WorkerModule {
  static register(options: WorkerModuleRegistration = {}): DynamicModule {
    return {
      module: WorkerModule,
      providers: [
        ...(options.providers ?? []),
        {
          provide: WORKER_PROCESSORS,
          useFactory: (...processors: WorkerProcessor[]) => processors,
          inject: options.processorTokens ?? [],
        },
      ],
      exports: [WORKER_PROCESSORS],
    };
  }
}

export interface WorkerModuleRegistration {
  providers?: Provider[];
  processorTokens?: InjectionToken[];
}

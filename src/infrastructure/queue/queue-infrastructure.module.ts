import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { AsyncJobContextService } from './async-job-context.service';
import { QueueFailureReporter } from './queue-failure-reporter.service';
import { QueueFactory } from './queue.factory';

@Module({
  imports: [RedisModule],
  providers: [AsyncJobContextService, QueueFactory, QueueFailureReporter],
  exports: [AsyncJobContextService, QueueFactory, QueueFailureReporter],
})
export class QueueInfrastructureModule {}

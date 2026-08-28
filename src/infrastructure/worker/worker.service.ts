import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import type Redis from 'ioredis';
import { ApplicationLogger } from '../../common/observability/application-logger.service';
import { AsyncJobContextService } from '../queue/async-job-context.service';
import type { AsyncJobEnvelope } from '../queue/async-job-context.service';
import { QueueFailureReporter } from '../queue/queue-failure-reporter.service';
import { RedisClientFactory } from '../redis/redis-client.factory';
import { buildWorkerRuntimePolicy } from '../queue/queue-options';
import type { WorkerProcessor } from './worker.types';

type EggShipWorker = Worker<AsyncJobEnvelope<unknown>, void, string>;

@Injectable()
export class WorkerService {
  private workers: Array<{ worker: EggShipWorker; connection: Redis }> = [];
  private stopping = false;

  constructor(
    private readonly config: ConfigService,
    private readonly redisFactory: RedisClientFactory,
    private readonly context: AsyncJobContextService,
    private readonly failures: QueueFailureReporter,
    private readonly logger: ApplicationLogger,
  ) {}

  async start(processors: readonly WorkerProcessor[]): Promise<void> {
    if (processors.length === 0)
      throw new Error('Worker cannot start without an approved processor.');
    const policy = buildWorkerRuntimePolicy({
      concurrency: this.config.get<number>('WORKER_CONCURRENCY'),
    });
    const redisUrl = this.config.getOrThrow<string>('REDIS_URL');
    for (const processor of processors) {
      const connection = this.redisFactory.createWorkerClient(redisUrl);
      const worker = new Worker<AsyncJobEnvelope<unknown>, void, string>(
        processor.queueName,
        async (job) => {
          if (processor.jobName !== undefined && processor.jobName !== job.name)
            return;
          const started = Date.now();
          const correlationId = job.data?.metadata?.correlationId ?? 'invalid';
          this.logger.info(
            {
              module: 'worker',
              operation: 'job_started',
              queue: processor.queueName,
              jobId: job.id,
              jobName: job.name,
              attemptNumber: job.attemptsMade + 1,
            },
            'Worker job started',
          );
          try {
            await this.context.runWithEnvelope(job.data, () =>
              processor.process(job),
            );
            this.logger.info(
              {
                module: 'worker',
                operation: 'job_completed',
                queue: processor.queueName,
                jobId: job.id,
                jobName: job.name,
                durationMs: Date.now() - started,
              },
              'Worker job completed',
            );
          } catch (error: unknown) {
            const normalized =
              error instanceof Error
                ? error
                : new Error('Worker processor failed.');
            this.failures.report(
              {
                queueName: processor.queueName,
                jobName: job.name,
                jobId: job.id,
                attemptsMade: job.attemptsMade + 1,
                correlationId,
              },
              normalized,
            );
            throw normalized;
          }
        },
        {
          connection,
          concurrency: policy.concurrency,
          lockDuration: policy.lockDurationMs,
        },
      );
      await worker.waitUntilReady();
      this.workers.push({ worker, connection });
    }
    this.logger.info(
      {
        module: 'worker',
        operation: 'ready',
        processorCount: processors.length,
        concurrency: policy.concurrency,
      },
      'Worker is ready',
    );
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.logger.info(
      { module: 'worker', operation: 'stopping' },
      'Worker stopping',
    );
    const timeoutMs =
      this.config.get<number>('WORKER_SHUTDOWN_TIMEOUT_MS') ?? 30_000;
    for (const resource of this.workers) {
      await this.closeWithGrace(resource.worker, timeoutMs);
      if (resource.connection.status === 'ready')
        await resource.connection.quit();
      else resource.connection.disconnect(false);
    }
    this.workers = [];
    this.logger.info(
      { module: 'worker', operation: 'stopped' },
      'Worker stopped',
    );
  }

  private async closeWithGrace(
    worker: EggShipWorker,
    timeoutMs: number,
  ): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        worker.close().then(() => 'closed' as const),
        new Promise<'timed_out'>((resolve) => {
          timer = setTimeout(() => resolve('timed_out'), timeoutMs);
        }),
      ]);
      if (result === 'timed_out') await worker.close(true);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

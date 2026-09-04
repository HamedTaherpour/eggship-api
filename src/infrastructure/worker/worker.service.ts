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
  private activeJobs = 0;
  private activeJobsDrained: Promise<void> = Promise.resolve();
  private resolveActiveJobsDrained?: () => void;
  private ready = false;

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
      concurrency: this.configuredNumber('WORKER_CONCURRENCY'),
    });
    const redisUrl = this.config.getOrThrow<string>('REDIS_URL');
    try {
      for (const processor of processors) {
        const connection = this.redisFactory.createWorkerClient(redisUrl);
        const worker = new Worker<AsyncJobEnvelope<unknown>, void, string>(
          processor.queueName,
          async (job) => {
            if (
              processor.jobName !== undefined &&
              processor.jobName !== job.name
            )
              return;
            this.beginJob();
            const started = Date.now();
            const correlationId =
              job.data?.metadata?.correlationId ?? 'invalid';
            this.logger.info(
              {
                module: 'worker',
                operation: 'job_started',
                queue: processor.queueName,
                jobId: job.id,
                jobName: job.name,
                correlationId,
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
                  correlationId,
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
            } finally {
              this.finishJob();
            }
          },
          {
            connection,
            concurrency: policy.concurrency,
            lockDuration: policy.lockDurationMs,
          },
        );
        worker.on('error', (error: Error) => {
          this.logger.error(
            {
              module: 'worker',
              operation: 'worker_error',
              queue: processor.queueName,
            },
            'Worker infrastructure error',
            error,
          );
        });
        this.workers.push({ worker, connection });
        await worker.waitUntilReady();
      }
    } catch (error: unknown) {
      await this.stop();
      throw error;
    }
    this.ready = true;
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
    this.ready = false;
    this.logger.info(
      { module: 'worker', operation: 'stopping' },
      'Worker stopping',
    );
    const timeoutMs =
      this.configuredNumber('WORKER_SHUTDOWN_TIMEOUT_MS') ?? 30_000;
    await Promise.all(
      this.workers.map((resource) => resource.worker.pause(true)),
    );
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

  isReady(): boolean {
    return this.ready;
  }

  private async closeWithGrace(
    worker: EggShipWorker,
    timeoutMs: number,
  ): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        this.activeJobsDrained.then(() => 'closed' as const),
        new Promise<'timed_out'>((resolve) => {
          timer = setTimeout(() => resolve('timed_out'), timeoutMs);
        }),
      ]);
      if (result === 'timed_out') {
        await worker.close(true);
      } else {
        await worker.close();
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private beginJob(): void {
    if (this.activeJobs === 0) {
      this.activeJobsDrained = new Promise<void>((resolve) => {
        this.resolveActiveJobsDrained = resolve;
      });
    }
    this.activeJobs += 1;
  }

  private finishJob(): void {
    this.activeJobs -= 1;
    if (this.activeJobs === 0) {
      this.resolveActiveJobsDrained?.();
      this.resolveActiveJobsDrained = undefined;
    }
  }

  private configuredNumber(name: string): number | undefined {
    const value = this.config.get<number | string>(name);
    return value === undefined ? undefined : Number(value);
  }
}

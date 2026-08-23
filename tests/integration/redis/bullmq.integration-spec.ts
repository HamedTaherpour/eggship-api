import { PassThrough } from 'node:stream';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { UnrecoverableError, Worker } from 'bullmq';
import type { Job, Queue } from 'bullmq';
import type Redis from 'ioredis';
import { LOG_DESTINATION } from '../../../src/common/observability/application-logger.service';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { RequestContextService } from '../../../src/common/observability/request-context.service';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { AsyncJobContextService } from '../../../src/infrastructure/queue/async-job-context.service';
import type { AsyncJobEnvelope } from '../../../src/infrastructure/queue/async-job-context.service';
import { QueueInfrastructureModule } from '../../../src/infrastructure/queue/queue-infrastructure.module';
import { DEFAULT_JOB_OPTIONS } from '../../../src/infrastructure/queue/queue-options';
import { QueueFactory } from '../../../src/infrastructure/queue/queue.factory';
import { RedisClientFactory } from '../../../src/infrastructure/redis/redis-client.factory';
import { bullmqIntegrationQueueName } from '../support/test-run-id';

interface ProbeJobData {
  probeId: string;
  mode?: 'succeed' | 'fail-once' | 'fail-permanent';
}

describe('BullMQ infrastructure (integration)', () => {
  let app: INestApplicationContext;
  let queue: Queue<AsyncJobEnvelope<ProbeJobData>>;
  let worker: Worker<AsyncJobEnvelope<ProbeJobData>, string>;
  let workerConnection: Redis;
  let inspectClient: Redis;
  let queueName: string;
  let jobContext: AsyncJobContextService;
  let requestContext: RequestContextService;
  let observedCorrelationId: string | undefined;
  let observedProbeId: string | undefined;
  const attemptByProbe = new Map<string, number>();

  beforeAll(async () => {
    const testRunId = process.env['EGGSHIP_TEST_RUN_ID'];
    if (testRunId === undefined || testRunId === '') {
      throw new Error('EGGSHIP_TEST_RUN_ID must be set by integration setup.');
    }
    queueName = bullmqIntegrationQueueName(testRunId);

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        QueueInfrastructureModule,
      ],
    })
      .overrideProvider(LOG_DESTINATION)
      .useValue(new PassThrough())
      .compile();

    app = moduleRef;
    await app.init();

    jobContext = moduleRef.get(AsyncJobContextService);
    requestContext = moduleRef.get(RequestContextService);
    const queueFactory = moduleRef.get(QueueFactory);
    const redisFactory = moduleRef.get(RedisClientFactory);
    const redisUrl = process.env['TEST_REDIS_URL'];
    if (redisUrl === undefined) {
      throw new Error(
        'TEST_REDIS_URL must be set for BullMQ integration tests.',
      );
    }

    queue = queueFactory.create<ProbeJobData>(queueName);
    workerConnection = redisFactory.createWorkerClient(redisUrl);
    inspectClient = redisFactory.createQueueClient(redisUrl);
    await inspectClient.connect();
    worker = new Worker<AsyncJobEnvelope<ProbeJobData>, string>(
      queueName,
      (job) =>
        Promise.resolve(
          jobContext.runWithEnvelope(job.data, () => {
            observedCorrelationId = requestContext.getCorrelationId();
            observedProbeId = job.data.data.probeId;
            const mode = job.data.data.mode ?? 'succeed';
            const attempts =
              (attemptByProbe.get(job.data.data.probeId) ?? 0) + 1;
            attemptByProbe.set(job.data.data.probeId, attempts);

            if (mode === 'fail-once' && attempts === 1) {
              throw new Error('transient probe failure');
            }
            if (mode === 'fail-permanent') {
              throw new UnrecoverableError('permanent probe failure');
            }
            return 'ok';
          }),
        ),
      { connection: workerConnection },
    );
  });

  afterAll(async () => {
    if (worker !== undefined) {
      await worker.close();
    }
    if (workerConnection !== undefined) {
      if (workerConnection.status === 'ready') {
        await workerConnection.quit();
      } else {
        workerConnection.disconnect(false);
      }
    }
    if (queue !== undefined) {
      await queue.obliterate({ force: true });
      await queue.close();
    }
    if (inspectClient !== undefined) {
      const leftover = await inspectClient.keys(`bull:${queueName}:*`);
      if (leftover.length > 0) {
        await inspectClient.del(...leftover);
      }
      if (inspectClient.status === 'ready') {
        await inspectClient.quit();
      } else {
        inspectClient.disconnect(false);
      }
    }
    if (app !== undefined) {
      await app.close();
    }
  });

  it('applies repository default retry, backoff, and retention options', () => {
    expect(queue.jobsOpts).toMatchObject({
      attempts: DEFAULT_JOB_OPTIONS.attempts,
      backoff: DEFAULT_JOB_OPTIONS.backoff,
      removeOnComplete: DEFAULT_JOB_OPTIONS.removeOnComplete,
      removeOnFail: DEFAULT_JOB_OPTIONS.removeOnFail,
    });
  });

  it('enqueues an infrastructure-only job and preserves correlation metadata', async () => {
    const correlationId = `corr_integration_${queueName}`;
    const probeId = `probe_${queueName}`;

    const completed = waitForProbe(worker, {
      probeId,
      event: 'completed',
      timeoutMs: 15_000,
    });
    await requestContext.run(
      { requestId: 'req_integration', correlationId },
      () => {
        const envelope = jobContext.createEnvelope<ProbeJobData>({ probeId });
        return queue.add('integration_probe', envelope);
      },
    );

    await completed;
    expect(observedCorrelationId).toBe(correlationId);
    expect(observedProbeId).toBe(probeId);
  });

  it('persists queued jobs under BullMQ Redis key patterns for this queue only', async () => {
    const probeId = `persist_${queueName}`;
    const envelope = jobContext.createEnvelope<ProbeJobData>({
      probeId,
      mode: 'succeed',
    });

    await worker.pause();
    const job = await queue.add('integration_persist', envelope);
    const keys = await inspectClient.keys(`bull:${queueName}:*`);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key) => key.startsWith(`bull:${queueName}:`))).toBe(
      true,
    );

    const patterns = summarizeBullmqKeyPatterns(keys, queueName);
    expect(patterns.length).toBeGreaterThan(0);
    expect(
      patterns.some(
        (pattern) =>
          pattern === 'bull:<queue>:meta' ||
          pattern === 'bull:<queue>:id' ||
          pattern === 'bull:<queue>:wait' ||
          pattern === 'bull:<queue>:<jobId>',
      ),
    ).toBe(true);
    expect(job.id).toBeDefined();

    const completed = waitForProbe(worker, {
      probeId,
      event: 'completed',
      timeoutMs: 15_000,
    });
    await worker.resume();
    await completed;
  });

  it('retries a transient failure with configured attempts then completes', async () => {
    const probeId = `retry_${queueName}`;
    const completed = waitForProbe(worker, {
      probeId,
      event: 'completed',
      timeoutMs: 20_000,
    });

    await queue.add(
      'integration_retry',
      jobContext.createEnvelope<ProbeJobData>({
        probeId,
        mode: 'fail-once',
      }),
      {
        attempts: 3,
        backoff: { type: 'fixed', delay: 50 },
      },
    );

    const job = await completed;
    expect(job.data.data.probeId).toBe(probeId);
    expect(attemptByProbe.get(probeId)).toBe(2);
    expect(job.attemptsMade).toBeGreaterThanOrEqual(2);
  });

  it('retains exhausted failures according to removeOnFail defaults', async () => {
    const probeId = `fail_${queueName}`;
    const failed = waitForProbe(worker, {
      probeId,
      event: 'failed',
      timeoutMs: 15_000,
    });

    await queue.add(
      'integration_fail',
      jobContext.createEnvelope<ProbeJobData>({
        probeId,
        mode: 'fail-permanent',
      }),
      {
        attempts: 1,
        removeOnFail: DEFAULT_JOB_OPTIONS.removeOnFail,
      },
    );

    const job = await failed;
    expect(job.data.data.probeId).toBe(probeId);
    expect(job.failedReason).toContain('permanent probe failure');

    const retained = await queue.getJob(job.id ?? '');
    expect(retained).not.toBeUndefined();
    expect(await retained?.isFailed()).toBe(true);
  });

  it('treats custom job ids as idempotent for the same queue', async () => {
    const jobId = `custom_${queueName}`;
    const envelope = jobContext.createEnvelope<ProbeJobData>({
      probeId: `dup_${queueName}`,
    });

    await worker.pause();
    const first = await queue.add('integration_dup_a', envelope, { jobId });
    const second = await queue.add('integration_dup_b', envelope, { jobId });
    expect(first.id).toBe(jobId);
    expect(second.id).toBe(jobId);
    const waiting = await queue.getJobs(['waiting', 'delayed', 'prioritized']);
    expect(waiting.filter((job) => job.id === jobId)).toHaveLength(1);
    await queue.remove(jobId);
    await worker.resume();
  });
});

function waitForProbe(
  worker: Worker<AsyncJobEnvelope<ProbeJobData>, string>,
  options: {
    probeId: string;
    event: 'completed' | 'failed';
    timeoutMs: number;
  },
): Promise<Job<AsyncJobEnvelope<ProbeJobData>, string>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for BullMQ ${options.event} for probe ${options.probeId}.`,
        ),
      );
    }, options.timeoutMs);

    const matches = (
      job: Job<AsyncJobEnvelope<ProbeJobData>, string> | undefined,
    ): job is Job<AsyncJobEnvelope<ProbeJobData>, string> =>
      job !== undefined && job.data.data.probeId === options.probeId;

    const onCompleted = (
      job: Job<AsyncJobEnvelope<ProbeJobData>, string>,
    ): void => {
      if (options.event !== 'completed' || !matches(job)) {
        return;
      }
      cleanup();
      resolve(job);
    };

    const onFailed = (
      job: Job<AsyncJobEnvelope<ProbeJobData>, string> | undefined,
      error: Error,
    ): void => {
      if (!matches(job)) {
        return;
      }
      if (options.event === 'failed') {
        cleanup();
        resolve(job);
        return;
      }
      // Transient failures while waiting for completion must not abort the wait.
      if ((job.opts.attempts ?? 1) > job.attemptsMade) {
        return;
      }
      cleanup();
      reject(error);
    };

    const cleanup = (): void => {
      clearTimeout(timer);
      worker.off('completed', onCompleted);
      worker.off('failed', onFailed);
    };

    worker.on('completed', onCompleted);
    worker.on('failed', onFailed);
  });
}

function summarizeBullmqKeyPatterns(
  keys: string[],
  queueName: string,
): string[] {
  const prefix = `bull:${queueName}:`;
  const patterns = new Set<string>();
  for (const key of keys) {
    if (!key.startsWith(prefix)) {
      continue;
    }
    const suffix = key.slice(prefix.length);
    if (
      suffix === 'id' ||
      suffix === 'meta' ||
      suffix === 'events' ||
      suffix === 'wait' ||
      suffix === 'active' ||
      suffix === 'completed' ||
      suffix === 'failed' ||
      suffix === 'delayed' ||
      suffix === 'paused' ||
      suffix === 'marker' ||
      suffix === 'stalled-check' ||
      suffix === 'pc' ||
      suffix === 'priority'
    ) {
      patterns.add(`bull:<queue>:${suffix}`);
      continue;
    }
    if (/^\d+$/u.test(suffix) || suffix.startsWith('custom_')) {
      patterns.add('bull:<queue>:<jobId>');
      continue;
    }
    patterns.add(`bull:<queue>:${suffix.split(':')[0] ?? 'other'}`);
  }
  return [...patterns].sort();
}

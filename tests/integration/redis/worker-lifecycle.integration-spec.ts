import { PassThrough } from 'node:stream';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Job, Queue } from 'bullmq';
import { LOG_DESTINATION } from '../../../src/common/observability/application-logger.service';
import { RequestContextService } from '../../../src/common/observability/request-context.service';
import { AsyncJobContextService } from '../../../src/infrastructure/queue/async-job-context.service';
import type { AsyncJobEnvelope } from '../../../src/infrastructure/queue/async-job-context.service';
import { QueueFactory } from '../../../src/infrastructure/queue/queue.factory';
import { WorkerAppModule } from '../../../src/worker.module';
import { WORKER_PROCESSORS } from '../../../src/infrastructure/worker/worker.tokens';
import { WorkerService } from '../../../src/infrastructure/worker/worker.service';
import type { WorkerProcessor } from '../../../src/infrastructure/worker/worker.types';
import { createTestRunId } from '../support/test-run-id';

const runId = process.env['EGGSHIP_TEST_RUN_ID'] ?? createTestRunId();
const lifecycleQueueName = `eggship-worker-${runId}`;
process.env['WORKER_CONCURRENCY'] = '2';
process.env['WORKER_SHUTDOWN_TIMEOUT_MS'] = '1000';

interface ProbeData {
  probeId: string;
  mode?: 'succeed' | 'fail-once' | 'fail-permanent';
}

interface Harness {
  app: INestApplicationContext;
  queue: Queue<AsyncJobEnvelope<ProbeData>>;
  lifecycle: WorkerService;
  context: AsyncJobContextService;
  requestContext: RequestContextService;
  logs: PassThrough;
  logText: { value: string };
  processor: ProbeProcessor;
}

class ProbeProcessor implements WorkerProcessor {
  readonly queueName: string;
  readonly attempts = new Map<string, number>();
  readonly seen = new Set<string>();
  readonly completed: string[] = [];
  readonly started = new Map<string, Promise<void>>();
  readonly startSignals = new Map<string, () => void>();
  readonly observedCorrelation = new Map<string, string | undefined>();
  readonly maxActiveRef = { value: 0 };
  active = 0;
  block?: { entered: Promise<void>; release: () => void };

  requestContext?: RequestContextService;

  constructor(queueName: string) {
    this.queueName = queueName;
  }

  process(job: Job<AsyncJobEnvelope<ProbeData>>): Promise<void> {
    const { probeId, mode } = job.data.data;
    const attempt = (this.attempts.get(probeId) ?? 0) + 1;
    this.attempts.set(probeId, attempt);
    this.active += 1;
    this.maxActiveRef.value = Math.max(this.maxActiveRef.value, this.active);
    const correlationId = this.requestContext?.getCorrelationId();
    this.observedCorrelation.set(probeId, correlationId);
    this.startSignals.get(probeId)?.();
    const run = async (): Promise<void> => {
      try {
        if (this.block !== undefined) await this.block.entered;
        if (mode === 'fail-once' && attempt === 1)
          throw new Error('transient probe failure');
        if (mode === 'fail-permanent')
          throw new Error('permanent probe failure');
        this.seen.add(probeId);
        this.completed.push(probeId);
      } finally {
        this.active -= 1;
      }
    };
    return run();
  }

  waitForStart(probeId: string): Promise<void> {
    const promise = new Promise<void>((resolve) => {
      this.startSignals.set(probeId, resolve);
    });
    this.started.set(probeId, promise);
    return promise;
  }
}

describe('WorkerService lifecycle (integration)', () => {
  jest.setTimeout(30_000);
  const redisUrl = process.env['TEST_REDIS_URL'];
  const originalConcurrency = process.env['WORKER_CONCURRENCY'];
  const originalShutdownTimeout = process.env['WORKER_SHUTDOWN_TIMEOUT_MS'];

  beforeAll(() => {
    if (redisUrl !== 'redis://127.0.0.1:6380')
      throw new Error(
        'ASY-03 lifecycle tests require TEST_REDIS_URL=redis://127.0.0.1:6380.',
      );
  });

  afterAll(() => {
    restoreEnv('WORKER_CONCURRENCY', originalConcurrency);
    restoreEnv('WORKER_SHUTDOWN_TIMEOUT_MS', originalShutdownTimeout);
  });

  it('refuses production-style bootstrap with zero processors', async () => {
    const app = await Test.createTestingModule({
      imports: [WorkerAppModule],
    }).compile();
    const lifecycle = app.get(WorkerService);
    await app.init();
    await expect(lifecycle.start([])).rejects.toThrow(
      'without an approved processor',
    );
    await app.close();
  });

  it('starts the real composition, consumes canonical jobs, restores correlation, and falls back safely', async () => {
    const harness = await createHarness();
    try {
      const nonHttpApp = harness.app as INestApplicationContext & {
        getHttpServer?: () => unknown;
      };
      expect(nonHttpApp.getHttpServer).toBeUndefined();
      await harness.lifecycle.start([harness.processor]);

      const canonicalId = `canonical-${runId}`;
      const canonicalStart = harness.processor.waitForStart(canonicalId);
      await harness.requestContext.run(
        { requestId: 'request-test', correlationId: 'corr-canonical' },
        () =>
          harness.queue.add(
            'canonical_probe',
            harness.context.createEnvelope({ probeId: canonicalId }),
          ),
      );
      await canonicalStart;
      expect(harness.processor.observedCorrelation.get(canonicalId)).toBe(
        'corr-canonical',
      );
      expect(harness.processor.completed).toContain(canonicalId);

      const fallbackId = `fallback-${runId}`;
      const fallbackStart = harness.processor.waitForStart(fallbackId);
      await harness.queue.add('fallback_probe', {
        metadata: {
          schemaVersion: 1,
          correlationId: 'bad value',
          enqueuedAt: 'never',
        },
        data: { probeId: fallbackId },
      });
      await fallbackStart;
      expect(harness.processor.observedCorrelation.get(fallbackId)).toMatch(
        /^[0-9a-f-]{36}$/u,
      );
      expect(harness.processor.completed).toContain(fallbackId);
      expect(harness.logText.value).toContain('job_started');
      expect(harness.logText.value).toContain('corr-canonical');
      expect(harness.logText.value).not.toContain(canonicalId);
    } finally {
      await disposeHarness(harness);
    }
  });

  it('uses WorkerService concurrency and retries transient failures while retaining permanent failures', async () => {
    const harness = await createHarness();
    try {
      await harness.lifecycle.start([harness.processor]);
      const ids = ['one', 'two', 'three', 'four'].map(
        (value) => `${value}-${runId}`,
      );
      const concurrencyRelease = deferred();
      harness.processor.block = {
        entered: concurrencyRelease.promise,
        release: concurrencyRelease.resolve,
      };
      for (const probeId of ids)
        await harness.queue.add(
          'concurrency_probe',
          harness.context.createEnvelope({ probeId }),
        );
      await waitUntil(() => harness.processor.active >= 2, 5_000);
      concurrencyRelease.resolve();
      await waitUntil(() => harness.processor.completed.length === ids.length);
      expect(harness.processor.maxActiveRef.value).toBe(2);

      const retryId = `retry-${runId}`;
      await harness.queue.add(
        'retry_probe',
        harness.context.createEnvelope({ probeId: retryId, mode: 'fail-once' }),
        {
          attempts: 3,
          backoff: { type: 'fixed', delay: 10 },
        },
      );
      await waitUntil(() => harness.processor.completed.includes(retryId));
      expect(harness.processor.attempts.get(retryId)).toBe(2);

      const failedId = `failed-${runId}`;
      await harness.queue.add(
        'permanent_probe',
        harness.context.createEnvelope({
          probeId: failedId,
          mode: 'fail-permanent',
        }),
        {
          attempts: 1,
        },
      );
      await waitUntil(
        async () =>
          ((await harness.queue.getJobCounts('failed')).failed ?? 0) > 0,
      );
      const failedJobs = await harness.queue.getJobs(['failed']);
      const failed = failedJobs.find(
        (job) => job.data.data.probeId === failedId,
      );
      expect(failed?.failedReason).toContain('permanent probe failure');
      expect(failed).toBeDefined();
    } finally {
      await disposeHarness(harness);
    }
  });

  it('gracefully stops delivery, drains in-flight work, and is idempotent', async () => {
    const harness = await createHarness();
    const release = deferred();
    harness.processor.block = {
      entered: release.promise,
      release: release.resolve,
    };
    try {
      await harness.lifecycle.start([harness.processor]);
      const probeId = `graceful-${runId}`;
      const started = harness.processor.waitForStart(probeId);
      await harness.queue.add(
        'graceful_probe',
        harness.context.createEnvelope({ probeId }),
      );
      await started;
      const stopping = harness.lifecycle.stop();
      const waitingId = `after-stop-${runId}`;
      const waitingJob = await harness.queue.add(
        'after_stop_probe',
        harness.context.createEnvelope({ probeId: waitingId }),
      );
      expect(await harness.queue.getJobState(waitingJob.id ?? '')).toBe(
        'waiting',
      );
      release.resolve();
      await stopping;
      await expect(harness.lifecycle.stop()).resolves.toBeUndefined();
      expect(harness.processor.completed).toContain(probeId);
      expect(harness.processor.completed).not.toContain(waitingId);
    } finally {
      release.resolve();
      await disposeHarness(harness);
    }
  });

  it('forces shutdown after the grace window without acknowledging unfinished work', async () => {
    const harness = await createHarness();
    const never = deferred();
    harness.processor.block = {
      entered: never.promise,
      release: never.resolve,
    };
    try {
      await harness.lifecycle.start([harness.processor]);
      const probeId = `forced-${runId}`;
      const started = harness.processor.waitForStart(probeId);
      const forcedJob = await harness.queue.add(
        'forced_probe',
        harness.context.createEnvelope({ probeId }),
      );
      await started;
      const stopping = harness.lifecycle.stop();
      await waitForTimeout(1_500);
      expect(harness.processor.completed).not.toContain(probeId);
      expect(await harness.queue.getJobState(forcedJob.id ?? '')).not.toBe(
        'completed',
      );
      never.resolve();
      await stopping;
    } finally {
      never.resolve();
      await disposeHarness(harness);
    }
  }, 10_000);

  it('restarts with a fresh WorkerService and consumes persisted pending work', async () => {
    const first = await createHarness();
    const probeId = `restart-${runId}`;
    try {
      await first.queue.pause();
      await first.queue.add(
        'restart_probe',
        first.context.createEnvelope({ probeId }),
      );
      await first.lifecycle.start([first.processor]);
      await first.lifecycle.stop();
      await first.queue.resume();
    } finally {
      await disposeHarness(first);
    }
    const second = await createHarness();
    try {
      await second.lifecycle.start([second.processor]);
      await waitUntil(() => second.processor.completed.includes(probeId));
      expect(second.processor.seen.has(probeId)).toBe(true);
    } finally {
      await disposeHarness(second);
    }
  });

  it('distributes same-queue jobs across two real WorkerService instances without app locks', async () => {
    const first = await createHarness();
    const second = await createHarness();
    try {
      await first.lifecycle.start([first.processor]);
      await second.lifecycle.start([second.processor]);
      const ids = ['a', 'b', 'c', 'd'].map(
        (value) => `multi-${value}-${runId}`,
      );
      for (const probeId of ids)
        await first.queue.add(
          'multi_probe',
          first.context.createEnvelope({ probeId }),
        );
      await waitUntil(
        () =>
          first.processor.completed.length +
            second.processor.completed.length ===
          ids.length,
      );
      expect(
        new Set([...first.processor.completed, ...second.processor.completed])
          .size,
      ).toBe(ids.length);
      expect(first.processor.completed.length).toBeGreaterThan(0);
      expect(second.processor.completed.length).toBeGreaterThan(0);
    } finally {
      await Promise.all([disposeHarness(first), disposeHarness(second)]);
    }
  });
});

async function createHarness(): Promise<Harness> {
  const logs = new PassThrough();
  const logText = { value: '' };
  logs.on('data', (chunk: Buffer) => {
    logText.value += chunk.toString();
  });
  const processor = new ProbeProcessor(lifecycleQueueName);
  const moduleRef = await Test.createTestingModule({
    imports: [WorkerAppModule],
  })
    .overrideProvider(WORKER_PROCESSORS)
    .useValue([processor])
    .overrideProvider(LOG_DESTINATION)
    .useValue(logs)
    .compile();
  await moduleRef.init();
  const requestContext = moduleRef.get(RequestContextService);
  processor.requestContext = requestContext;
  const queue = moduleRef
    .get(QueueFactory)
    .create<ProbeData>(lifecycleQueueName);
  return {
    app: moduleRef,
    queue,
    lifecycle: moduleRef.get(WorkerService),
    context: moduleRef.get(AsyncJobContextService),
    requestContext,
    logs,
    logText,
    processor,
  };
}

async function disposeHarness(harness: Harness): Promise<void> {
  try {
    await harness.lifecycle.stop();
  } finally {
    await harness.app.close();
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() >= deadline)
      throw new Error('Timed out waiting for worker lifecycle condition.');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function waitForTimeout(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

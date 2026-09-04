import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { QueueFactory } from '../../../src/infrastructure/queue/queue.factory';
import { AsyncJobContextService } from '../../../src/infrastructure/queue/async-job-context.service';
import { QueueInfrastructureModule } from '../../../src/infrastructure/queue/queue-infrastructure.module';
import { WorkerModule } from '../../../src/infrastructure/worker/worker.module';
import { WorkerService } from '../../../src/infrastructure/worker/worker.service';
import type { WorkerProcessor } from '../../../src/infrastructure/worker/worker.types';
import { ConfigModule } from '@nestjs/config';
import { createWorkerConfigModuleOptions } from '../../../src/config/worker-config-module.options';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';
import type { INestApplicationContext } from '@nestjs/common';

// Worker config is intentionally fail-closed for FCM. These are synthetic
// values used only to compose the worker while the provider boundary is not
// registered in this infrastructure-focused harness.
process.env['FCM_PROJECT_ID'] ??= 'not05-integration-project';
process.env['FCM_CLIENT_EMAIL'] ??= 'not05-integration@example.invalid';
process.env['FCM_PRIVATE_KEY'] ??=
  '-----BEGIN PRIVATE KEY-----\\nnot05\\n-----END PRIVATE KEY-----';

describe('NOT-05 notification worker Redis/BullMQ proof (integration)', () => {
  let queueFactory: QueueFactory;
  let context: AsyncJobContextService;
  let worker: WorkerService;
  let app: INestApplicationContext;

  beforeAll(async () => {
    assertDestructiveOperationsAllowed();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createWorkerConfigModuleOptions()),
        ObservabilityModule,
        QueueInfrastructureModule,
        WorkerModule.register(),
      ],
    }).compile();
    app = moduleRef;
    queueFactory = moduleRef.get(QueueFactory);
    context = moduleRef.get(AsyncJobContextService);
    worker = moduleRef.get(WorkerService);
    await moduleRef.init();
  });

  afterAll(async () => {
    if (worker !== undefined) await worker.stop();
    if (app !== undefined) await app.close();
  });

  it('delivers the canonical order-status job through the real queue and drains cleanly', async () => {
    const queueName = `not05-${randomUUID()}`;
    const observed: string[] = [];
    const processor: WorkerProcessor = {
      identity: 'notifications.order-status.v1',
      queueName,
      jobName: 'order.status.changed',
      process(job: Job): Promise<void> {
        observed.push(job.id ?? '');
        return Promise.resolve();
      },
    };
    const queue = queueFactory.create(queueName, { attempts: 1 });
    await worker.start([processor]);
    const orderId = randomUUID();
    await queue.add(
      'order.status.changed',
      context.createEnvelope({ orderId }),
      { jobId: orderId },
    );
    await waitUntil(() => observed.includes(orderId));
    expect(observed).toEqual([orderId]);
    await queue.close();
  });

  it('uses BullMQ bounded retry semantics for transient worker failures', async () => {
    const queueName = `not05-retry-${randomUUID()}`;
    let attempts = 0;
    const processor: WorkerProcessor = {
      identity: 'notifications.order-status.v1',
      queueName,
      jobName: 'order.status.changed',
      process(): Promise<void> {
        attempts += 1;
        if (attempts === 1)
          return Promise.reject(new Error('transient test failure'));
        return Promise.resolve();
      },
    };
    const queue = queueFactory.create(queueName, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 10 },
    });
    await worker.start([processor]);
    await queue.add(
      'order.status.changed',
      context.createEnvelope({ orderId: randomUUID() }),
    );
    await waitUntil(() => attempts === 2);
    expect(attempts).toBe(2);
    await queue.close();
  });
});

async function waitUntil(
  condition: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline)
      throw new Error('Timed out waiting for BullMQ proof.');
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

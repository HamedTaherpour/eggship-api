import { PassThrough } from 'node:stream';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Worker } from 'bullmq';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { LOG_DESTINATION } from '../../../src/common/observability/application-logger.service';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { RequestContextService } from '../../../src/common/observability/request-context.service';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { AsyncJobContextService } from '../../../src/infrastructure/queue/async-job-context.service';
import type { AsyncJobEnvelope } from '../../../src/infrastructure/queue/async-job-context.service';
import { QueueInfrastructureModule } from '../../../src/infrastructure/queue/queue-infrastructure.module';
import { QueueFactory } from '../../../src/infrastructure/queue/queue.factory';
import { RedisClientFactory } from '../../../src/infrastructure/redis/redis-client.factory';
import { bullmqIntegrationQueueName } from '../support/test-run-id';

interface ProbeJobData {
  probeId: string;
}

describe('BullMQ infrastructure (integration)', () => {
  let app: INestApplicationContext;
  let queue: Queue<AsyncJobEnvelope<ProbeJobData>>;
  let worker: Worker<AsyncJobEnvelope<ProbeJobData>, string>;
  let workerConnection: Redis;
  let queueName: string;
  let jobContext: AsyncJobContextService;
  let requestContext: RequestContextService;
  let observedCorrelationId: string | undefined;
  let observedProbeId: string | undefined;

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
    worker = new Worker<AsyncJobEnvelope<ProbeJobData>, string>(
      queueName,
      (job) =>
        Promise.resolve(
          jobContext.runWithEnvelope(job.data, () => {
            observedCorrelationId = requestContext.getCorrelationId();
            observedProbeId = job.data.data.probeId;
            return 'ok';
          }),
        ),
      { connection: workerConnection },
    );
  });

  afterAll(async () => {
    await worker.close();
    if (workerConnection.status === 'ready') {
      await workerConnection.quit();
    } else {
      workerConnection.disconnect(false);
    }
    await queue.obliterate({ force: true });
    await queue.close();
    await app.close();
  });

  it('enqueues an infrastructure-only job and preserves correlation metadata', async () => {
    const correlationId = `corr_integration_${queueName}`;
    const probeId = `probe_${queueName}`;

    const completed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for BullMQ integration job.'));
      }, 15_000);
      worker.on('completed', () => {
        clearTimeout(timer);
        resolve();
      });
      worker.on('failed', (_job, error) => {
        clearTimeout(timer);
        reject(error);
      });
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
});

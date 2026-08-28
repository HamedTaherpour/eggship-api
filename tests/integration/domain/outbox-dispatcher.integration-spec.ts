import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { Test } from '@nestjs/testing';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { QueueFactory } from '../../../src/infrastructure/queue/queue.factory';
import type { AsyncJobEnvelope } from '../../../src/infrastructure/queue/async-job-context.service';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import {
  OutboxDispatcher,
  OUTBOX_QUEUE_NAME,
} from '../../../src/modules/outbox/application/outbox-dispatcher';
import { OutboxModule } from '../../../src/modules/outbox/outbox.module';
const testRunId = process.env['EGGSHIP_TEST_RUN_ID'] ?? 'local';

interface OutboxJobData {
  outboxEventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  payload: { orderId: string; status: string };
}

describe('transactional outbox dispatcher (PostgreSQL + Redis integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let dispatcher: OutboxDispatcher;
  let queue: Queue<AsyncJobEnvelope<OutboxJobData>>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        OutboxModule,
      ],
    }).compile();
    app = moduleRef;
    await app.init();
    prisma = moduleRef.get(PrismaService);
    dispatcher = moduleRef.get(OutboxDispatcher);
    queue = moduleRef
      .get(QueueFactory)
      .create<OutboxJobData>(OUTBOX_QUEUE_NAME);
  });

  afterEach(async () => {
    await prisma.outboxEvent.deleteMany({
      where: { correlationId: { startsWith: testRunId } },
    });
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await queue.close();
    await app.close();
  });

  it('publishes NOT-03 order.status.changed v1 and marks it published', async () => {
    const eventId = randomUUID();
    await createEvent(eventId, 'PENDING');

    await expect(dispatcher.dispatchBatch()).resolves.toMatchObject({
      claimed: 1,
      published: 1,
      failed: 0,
    });
    expect(
      await prisma.outboxEvent.findUnique({ where: { id: eventId } }),
    ).toMatchObject({
      state: 'PUBLISHED',
      attemptCount: 1,
    });
    const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized']);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe(`outbox-${eventId}`);
    expect(jobs[0]?.data).toMatchObject({
      metadata: { schemaVersion: 1, correlationId: `${testRunId}.order` },
      data: {
        outboxEventId: eventId,
        eventType: 'order.status.changed',
        eventVersion: 1,
        payload: { status: 'PENDING' },
      },
    });
  });

  it('claims concurrently without losing events or creating duplicate jobs', async () => {
    const eventIds = await Promise.all(
      ['CONFIRMED', 'SHIPPED', 'DELIVERED'].map(async (status) => {
        const eventId = randomUUID();
        await createEvent(eventId, status);
        return eventId;
      }),
    );

    const reports = await Promise.all([
      dispatcher.dispatchBatch(),
      dispatcher.dispatchBatch(),
      dispatcher.dispatchBatch(),
    ]);
    expect(reports.reduce((sum, report) => sum + report.published, 0)).toBe(3);
    expect(
      await prisma.outboxEvent.count({
        where: { id: { in: eventIds }, state: 'PUBLISHED' },
      }),
    ).toBe(3);
    expect(
      await queue.getJobs(['waiting', 'delayed', 'prioritized']),
    ).toHaveLength(3);
  });

  async function createEvent(eventId: string, status: string): Promise<void> {
    await prisma.outboxEvent.create({
      data: {
        id: eventId,
        eventType: 'order.status.changed',
        eventVersion: 1,
        correlationId: `${testRunId}.order`,
        occurredAt: new Date(),
        payload: { orderId: randomUUID(), status },
      },
    });
  }
});

import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { Test } from '@nestjs/testing';
import { ApplicationLogger } from '../../../src/common/observability/application-logger.service';
import { RequestContextService } from '../../../src/common/observability/request-context.service';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { ConfigService } from '@nestjs/config';
import { AsyncJobContextService } from '../../../src/infrastructure/queue/async-job-context.service';
import { QueueFactory } from '../../../src/infrastructure/queue/queue.factory';
import type { AsyncJobEnvelope } from '../../../src/infrastructure/queue/async-job-context.service';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import {
  OutboxDispatcher,
  OUTBOX_QUEUE_NAME,
} from '../../../src/modules/outbox/application/outbox-dispatcher';
import { OutboxModule } from '../../../src/modules/outbox/outbox.module';

const testRunId = (): string => process.env['EGGSHIP_TEST_RUN_ID'] ?? 'local';

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

  beforeEach(async () => {
    await prisma.outboxEvent.deleteMany({});
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await queue.close();
    await app.close();
  });

  it('claims PENDING events, publishes NOT-03 order.status.changed v1, and acknowledges PUBLISHED', async () => {
    const eventId = randomUUID();
    await createEvent(eventId, 'PENDING');

    const claimed = await prisma.outboxEvent.findUnique({
      where: { id: eventId },
    });
    expect(claimed?.state).toBe('PENDING');

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
      claimToken: null,
      leaseExpiresAt: null,
    });
    const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized']);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe(`outbox-${eventId}`);
    expect(jobs[0]?.data).toMatchObject({
      metadata: { schemaVersion: 1, correlationId: `${testRunId()}.order` },
      data: {
        outboxEventId: eventId,
        eventType: 'order.status.changed',
        eventVersion: 1,
        payload: { status: 'PENDING' },
      },
    });
    const serialized = JSON.stringify(jobs[0]?.data);
    expect(serialized).not.toMatch(/password|secret|token|otp|@/iu);
  });

  it('claims concurrently with SKIP LOCKED without losing events or creating duplicate jobs', async () => {
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

  it('claims pending events in deterministic createdAt,id order', async () => {
    const createdAts = Array.from(
      { length: 52 },
      (_, index) => new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
    );
    const eventIds = await Promise.all(
      createdAts.map(async (createdAt, index) => {
        const eventId = randomUUID();
        await createEvent(eventId, `ORDER-${index}`, createdAt);
        return eventId;
      }),
    );

    await dispatcher.dispatchBatch();

    const publishedIds = (
      await prisma.outboxEvent.findMany({
        where: { id: { in: eventIds }, state: 'PUBLISHED' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      })
    ).map((row) => row.id);
    expect(publishedIds).toEqual(
      [...eventIds]
        .sort((left, right) => {
          const leftEvent = createdAts[eventIds.indexOf(left)]!;
          const rightEvent = createdAts[eventIds.indexOf(right)]!;
          return (
            leftEvent.getTime() - rightEvent.getTime() ||
            left.localeCompare(right)
          );
        })
        .slice(0, 50),
    );
    const pending = await prisma.outboxEvent.findMany({
      where: { state: 'PENDING' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    expect(pending.map((row) => row.id)).toEqual(
      [...eventIds]
        .sort((left, right) => {
          const leftEvent = createdAts[eventIds.indexOf(left)]!;
          const rightEvent = createdAts[eventIds.indexOf(right)]!;
          return (
            leftEvent.getTime() - rightEvent.getTime() ||
            left.localeCompare(right)
          );
        })
        .slice(50),
    );
  });

  it('claims only a bounded batch per dispatch', async () => {
    const eventIds = await Promise.all(
      Array.from({ length: 52 }, async (_, index) => {
        const eventId = randomUUID();
        await createEvent(eventId, `BATCH-${index}`);
        return eventId;
      }),
    );

    await expect(dispatcher.dispatchBatch()).resolves.toMatchObject({
      claimed: 50,
      published: 50,
      failed: 0,
    });
    expect(
      await prisma.outboxEvent.count({
        where: { id: { in: eventIds }, state: 'PUBLISHED' },
      }),
    ).toBe(50);
    expect(
      await prisma.outboxEvent.count({ where: { state: 'PENDING' } }),
    ).toBe(2);

    await expect(dispatcher.dispatchBatch()).resolves.toMatchObject({
      claimed: 2,
      published: 2,
      failed: 0,
    });
  });

  it('returns to PENDING with retry scheduling when Redis publication fails, then recovers', async () => {
    const eventId = randomUUID();
    await createEvent(eventId, 'RETRY');
    const failingQueueFactory = {
      create: jest.fn().mockReturnValue({
        add: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
      }),
    };
    const failingDispatcher = new OutboxDispatcher(
      prisma,
      failingQueueFactory as unknown as QueueFactory,
      app.get(AsyncJobContextService),
      app.get(RequestContextService),
      app.get(ApplicationLogger),
      app.get(ConfigService),
    );

    await expect(failingDispatcher.dispatchBatch()).resolves.toMatchObject({
      claimed: 1,
      published: 0,
      failed: 1,
    });
    const afterFailure = await prisma.outboxEvent.findUnique({
      where: { id: eventId },
    });
    expect(afterFailure).toMatchObject({
      state: 'PENDING',
      attemptCount: 1,
      claimToken: null,
      leaseExpiresAt: null,
    });
    expect(afterFailure?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    await prisma.outboxEvent.update({
      where: { id: eventId },
      data: { nextAttemptAt: new Date('2026-01-01T00:00:00.000Z') },
    });

    await expect(dispatcher.dispatchBatch()).resolves.toMatchObject({
      claimed: 1,
      published: 1,
      failed: 0,
    });
    expect(
      await prisma.outboxEvent.findUnique({ where: { id: eventId } }),
    ).toMatchObject({ state: 'PUBLISHED' });
  });

  it('reclaims expired leases for crash recovery without duplicate queue jobs', async () => {
    const eventId = randomUUID();
    await createEvent(eventId, 'LEASE');
    await prisma.outboxEvent.update({
      where: { id: eventId },
      data: {
        state: 'CLAIMED',
        attemptCount: 1,
        claimToken: randomUUID(),
        claimedAt: new Date('2026-01-01T00:00:00.000Z'),
        leaseExpiresAt: new Date('2026-01-01T00:00:01.000Z'),
        nextAttemptAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    await expect(dispatcher.dispatchBatch()).resolves.toMatchObject({
      claimed: 1,
      published: 1,
      failed: 0,
    });
    const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized']);
    expect(jobs.filter((job) => job.id === `outbox-${eventId}`)).toHaveLength(
      1,
    );
    expect(
      await prisma.outboxEvent.findUnique({ where: { id: eventId } }),
    ).toMatchObject({ state: 'PUBLISHED' });
  });

  it('does not republish already PUBLISHED events', async () => {
    const eventId = randomUUID();
    await createEvent(eventId, 'DONE');
    await dispatcher.dispatchBatch();
    await queue.obliterate({ force: true });

    await expect(dispatcher.dispatchBatch()).resolves.toMatchObject({
      claimed: 0,
      published: 0,
      failed: 0,
    });
    expect(
      await queue.getJobs(['waiting', 'delayed', 'prioritized']),
    ).toHaveLength(0);
  });

  async function createEvent(
    eventId: string,
    status: string,
    createdAt: Date = new Date(),
  ): Promise<void> {
    await prisma.outboxEvent.create({
      data: {
        id: eventId,
        eventType: 'order.status.changed',
        eventVersion: 1,
        correlationId: `${testRunId()}.order`,
        occurredAt: createdAt,
        createdAt,
        payload: { orderId: randomUUID(), status },
      },
    });
  }
});

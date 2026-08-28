import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Prisma } from '../../../src/generated/prisma/client';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { PrismaTransactionContext } from '../../../src/infrastructure/database/prisma/prisma-transaction-context';
import type { TransactionContext } from '../../../src/infrastructure/database/transaction';
import { OutboxPublisher } from '../../../src/modules/outbox/application/outbox-publisher';
import type { OutboxEventEnvelope } from '../../../src/modules/outbox/domain/outbox-event';
import { OutboxModule } from '../../../src/modules/outbox/outbox.module';

const testRunId = process.env['EGGSHIP_TEST_RUN_ID'] ?? 'local';
let sequence = 0;

function makeEnvelope(): OutboxEventEnvelope {
  sequence += 1;
  return {
    eventId: randomUUID(),
    eventType: 'test.business.changed',
    eventVersion: 1,
    occurredAt: new Date(),
    correlationId: `${testRunId}.${sequence}`,
    payload: { entityId: randomUUID() },
  };
}

describe('transactional outbox persistence (PostgreSQL integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let publisher: OutboxPublisher;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        OutboxModule,
      ],
    }).compile();
    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    publisher = moduleRef.get(OutboxPublisher);
    await app.init();
  });

  afterEach(async () => {
    await prisma.outboxEvent.deleteMany({
      where: { correlationId: { startsWith: testRunId } },
    });
    await prisma.category.deleteMany({
      where: { name: { startsWith: `ASY-01-${testRunId}` } },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('commits business state and outbox intent together', async () => {
    const event = makeEnvelope();
    const categoryName = `ASY-01-${testRunId}-${sequence}`;

    await prisma.$transaction(async (client) => {
      await client.category.create({ data: { name: categoryName } });
      await publisher.publish(event, new PrismaTransactionContext(client));
    });

    expect(
      await prisma.category.findFirst({ where: { name: categoryName } }),
    ).not.toBeNull();
    expect(
      await prisma.outboxEvent.findUnique({ where: { id: event.eventId } }),
    ).toMatchObject({
      id: event.eventId,
      state: 'PENDING',
      eventVersion: 1,
    });
  });

  it('rolls back business state and outbox intent together', async () => {
    const event = makeEnvelope();
    const categoryName = `ASY-01-${testRunId}-${sequence}`;

    await expect(
      prisma.$transaction(async (client) => {
        await client.category.create({ data: { name: categoryName } });
        await publisher.publish(event, new PrismaTransactionContext(client));
        throw new Error('test rollback');
      }),
    ).rejects.toThrow('test rollback');

    expect(
      await prisma.category.findFirst({ where: { name: categoryName } }),
    ).toBeNull();
    expect(
      await prisma.outboxEvent.findUnique({ where: { id: event.eventId } }),
    ).toBeNull();
  });

  it('requires the caller transaction and rejects duplicate identity', async () => {
    const event = makeEnvelope();
    await expect(
      publisher.publish(event, {} as unknown as TransactionContext),
    ).rejects.toThrow('Transaction context is invalid');

    await prisma.$transaction((client) =>
      publisher.publish(event, new PrismaTransactionContext(client)),
    );
    await expect(
      prisma.$transaction((client) =>
        publisher.publish(event, new PrismaTransactionContext(client)),
      ),
    ).rejects.toThrow();
    expect(
      await prisma.outboxEvent.count({ where: { id: event.eventId } }),
    ).toBe(1);
  });

  it('preserves identity under concurrent inserts', async () => {
    const event = makeEnvelope();
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        prisma.$transaction((client) =>
          publisher.publish(event, new PrismaTransactionContext(client)),
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      await prisma.outboxEvent.count({ where: { id: event.eventId } }),
    ).toBe(1);
  });

  it('enforces database type, version, payload, and publication constraints', async () => {
    const event = makeEnvelope();
    await expect(
      prisma.outboxEvent.create({
        data: { ...eventData(event), eventVersion: 0 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.outboxEvent.create({
        data: {
          ...eventData(event),
          id: randomUUID(),
          payload: ['not-object'] as Prisma.InputJsonValue,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.outboxEvent.create({
        data: { ...eventData(event), id: randomUUID(), state: 'PUBLISHED' },
      }),
    ).rejects.toThrow();
  });
});

function eventData(event: OutboxEventEnvelope): Prisma.OutboxEventCreateInput {
  return {
    id: event.eventId,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    correlationId: event.correlationId,
    occurredAt: event.occurredAt,
    payload: event.payload,
  };
}

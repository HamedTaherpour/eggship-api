import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Prisma } from '../../../generated/prisma/client';
import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { RequestContextService } from '../../../common/observability/request-context.service';
import { AsyncJobContextService } from '../../../infrastructure/queue/async-job-context.service';
import type { QueueFactory } from '../../../infrastructure/queue/queue.factory';
import type { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { OutboxDispatcher } from './outbox-dispatcher';

describe('OutboxDispatcher', () => {
  it('publishes a claimed event with a deterministic job id and acknowledges it', async () => {
    const event = claimedEvent();
    const add = jest.fn().mockResolvedValue({ id: `outbox-${event.id}` });
    const prisma = fakePrisma([event]);
    const dispatcher = createDispatcher(prisma, add);

    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      published: 1,
      failed: 0,
    });
    expect(add).toHaveBeenCalledWith(event.eventType, expect.anything(), {
      jobId: `outbox-${event.id}`,
    });
    expect(prisma.outboxEvent.updateMany).toHaveBeenCalledTimes(1);
  });

  it('releases a failed publication with bounded retry scheduling', async () => {
    const event = claimedEvent();
    const add = jest.fn().mockRejectedValue(new Error('Redis unavailable'));
    const prisma = fakePrisma([event]);
    const dispatcher = createDispatcher(prisma, add);

    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      published: 0,
      failed: 1,
    });
    expect(prisma.outboxEvent.updateMany).toHaveBeenCalledTimes(1);
  });
});

function claimedEvent(): {
  id: string;
  eventType: string;
  eventVersion: number;
  correlationId: string;
  occurredAt: Date;
  payload: Prisma.JsonValue;
  attemptCount: number;
} {
  return {
    id: randomUUID(),
    eventType: 'order.status.changed',
    eventVersion: 1,
    correlationId: 'test.correlation',
    occurredAt: new Date(),
    payload: { orderId: randomUUID(), status: 'PENDING' },
    attemptCount: 1,
  };
}

function fakePrisma(events: ReturnType<typeof claimedEvent>[]): {
  $queryRaw: jest.Mock;
  outboxEvent: { updateMany: jest.Mock };
} {
  return {
    $queryRaw: jest.fn().mockResolvedValue(events),
    outboxEvent: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
}

function createDispatcher(
  prisma: ReturnType<typeof fakePrisma>,
  add: jest.Mock,
): OutboxDispatcher {
  const queueFactory = {
    create: jest.fn().mockReturnValue({ add }),
  } as unknown as QueueFactory;
  const requestContext = new RequestContextService();
  const jobContext = new AsyncJobContextService(requestContext);
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
  } as unknown as ApplicationLogger;
  const config = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;
  return new OutboxDispatcher(
    prisma as unknown as PrismaService,
    queueFactory,
    jobContext,
    requestContext,
    logger,
    config,
  );
}

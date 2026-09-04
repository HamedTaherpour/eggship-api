import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Prisma } from '../../../generated/prisma/client';
import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { RequestContextService } from '../../../common/observability/request-context.service';
import { AsyncJobContextService } from '../../../infrastructure/queue/async-job-context.service';
import type { QueueFactory } from '../../../infrastructure/queue/queue.factory';
import type { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { ReplayDispatcher } from './replay-dispatcher';

describe('ReplayDispatcher', () => {
  it('publishes the immutable source with deterministic replay job identity', async () => {
    const replayId = randomUUID();
    const add = jest.fn().mockResolvedValue({ id: `replay-${replayId}` });
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: replayId,
          failureId: randomUUID(),
          outboxEventId: randomUUID(),
          deterministicJobId: `replay-${replayId}`,
          queueName: 'recovery-test',
          jobName: 'recover',
          eventType: 'test.event',
          eventVersion: 1,
          correlationId: 'replay.test',
          occurredAt: new Date(),
          payload: {
            orderId: randomUUID(),
            status: 'PENDING',
          } as Prisma.JsonValue,
          claimToken: randomUUID(),
          attemptCount: 1,
        },
      ]),
      asyncReplay: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    } as unknown as PrismaService;
    const factory = {
      create: jest.fn().mockReturnValue({ add }),
    } as unknown as QueueFactory;
    const context = new RequestContextService();
    const dispatcher = new ReplayDispatcher(
      prisma,
      factory,
      new AsyncJobContextService(context),
      context,
      { warn: jest.fn(), info: jest.fn() } as unknown as ApplicationLogger,
      { get: jest.fn() } as unknown as ConfigService,
    );

    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      published: 1,
      failed: 0,
    });
    expect(add).toHaveBeenCalledWith('recover', expect.anything(), {
      jobId: `replay-${replayId}`,
    });
  });

  it('leaves a claimed replay recoverable when Redis publication fails', async () => {
    const replayId = randomUUID();
    const updateMany = jest.fn();
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: replayId,
          failureId: randomUUID(),
          outboxEventId: randomUUID(),
          deterministicJobId: `replay-${replayId}`,
          queueName: 'recovery-test',
          jobName: 'recover',
          eventType: 'test.event',
          eventVersion: 1,
          correlationId: 'replay.test',
          occurredAt: new Date(),
          payload: {},
          claimToken: randomUUID(),
          attemptCount: 1,
        },
      ]),
      asyncReplay: { updateMany },
    } as unknown as PrismaService;
    const factory = {
      create: jest.fn().mockReturnValue({
        add: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
      }),
    } as unknown as QueueFactory;
    const context = new RequestContextService();
    const dispatcher = new ReplayDispatcher(
      prisma,
      factory,
      new AsyncJobContextService(context),
      context,
      { warn: jest.fn() } as unknown as ApplicationLogger,
      { get: jest.fn() } as unknown as ConfigService,
    );

    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      published: 0,
      failed: 1,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });
});

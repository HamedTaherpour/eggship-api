import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import {
  resolvePrismaConnection,
  type PrismaConnection,
} from '../../../infrastructure/database/prisma/prisma-transaction-context';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import { Prisma } from '../../../generated/prisma/client';

type FailureWithReplays = Prisma.AsyncFailureGetPayload<{
  include: { replays: true };
}>;

@Injectable()
export class AsyncRecoveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertFailure(input: {
    outboxEventId: string;
    processorIdentity: string;
    queueName: string;
    jobName: string;
    jobId?: string;
    eventType: string;
    eventVersion: number;
    correlationId: string;
    attemptCount: number;
    category: string;
    reasonCode: string;
    applicationVersion?: string;
  }): Promise<Prisma.AsyncFailureGetPayload<object>> {
    return this.prisma.asyncFailure.upsert({
      where: {
        outboxEventId_processorIdentity: {
          outboxEventId: input.outboxEventId,
          processorIdentity: input.processorIdentity,
        },
      },
      create: {
        ...input,
        lastAttemptAt: new Date(),
        category: input.category as never,
      },
      update: {
        jobId: input.jobId,
        attemptCount: input.attemptCount,
        lastAttemptAt: new Date(),
        category: input.category as never,
        reasonCode: input.reasonCode,
      },
    });
  }

  list(args: Prisma.AsyncFailureFindManyArgs): Promise<unknown[]> {
    return this.prisma.asyncFailure.findMany(args);
  }
  count(args: Prisma.AsyncFailureCountArgs): Promise<number> {
    return this.prisma.asyncFailure.count(args);
  }
  find(
    id: string,
    tx?: TransactionContext,
  ): Promise<FailureWithReplays | null> {
    return this.db(tx).asyncFailure.findUnique({
      where: { id },
      include: {
        replays: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
      },
    });
  }
  findReplay(id: string, tx?: TransactionContext): Promise<unknown> {
    return this.db(tx).asyncReplay.findUnique({ where: { id } });
  }
  findReplayByDeterministicJobId(deterministicJobId: string): Promise<unknown> {
    return this.prisma.asyncReplay.findUnique({
      where: { deterministicJobId },
    });
  }
  createReplay(
    data: Prisma.AsyncReplayUncheckedCreateInput,
    tx?: TransactionContext,
  ): Promise<Prisma.AsyncReplayGetPayload<object>> {
    return this.db(tx).asyncReplay.create({ data });
  }
  updateFailure(
    id: string,
    data: Prisma.AsyncFailureUpdateInput,
    tx?: TransactionContext,
  ): Promise<Prisma.AsyncFailureGetPayload<object>> {
    return this.db(tx).asyncFailure.update({ where: { id }, data });
  }
  updateReplay(
    id: string,
    data: Prisma.AsyncReplayUpdateInput,
    tx?: TransactionContext,
  ): Promise<unknown> {
    return this.db(tx).asyncReplay.update({ where: { id }, data });
  }

  async markReplayRunning(id: string): Promise<boolean> {
    const result = await this.prisma.asyncReplay.updateMany({
      where: { id, status: 'PUBLISHED' },
      data: { status: 'RUNNING' },
    });
    return result.count === 1;
  }

  async completeReplay(
    id: string,
    data: Prisma.AsyncReplayUpdateInput,
    tx?: TransactionContext,
  ): Promise<boolean> {
    const result = await this.db(tx).asyncReplay.updateMany({
      where: { id, status: 'RUNNING' },
      data,
    });
    return result.count === 1;
  }

  private db(tx?: TransactionContext): PrismaConnection {
    return resolvePrismaConnection(this.prisma, tx);
  }
}

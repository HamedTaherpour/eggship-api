import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../../generated/prisma/client';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { RequestContextService } from '../../../common/observability/request-context.service';
import { AsyncJobContextService } from '../../../infrastructure/queue/async-job-context.service';
import { QueueFactory } from '../../../infrastructure/queue/queue.factory';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { OutboxPayload } from '../../outbox/domain/outbox-event';

const DEFAULT_LEASE_SECONDS = 60;
const DEFAULT_BATCH_SIZE = 50;

type ClaimedReplay = {
  id: string;
  failureId: string;
  outboxEventId: string;
  deterministicJobId: string;
  queueName: string;
  jobName: string;
  eventType: string;
  eventVersion: number;
  correlationId: string;
  occurredAt: Date;
  payload: Prisma.JsonValue;
  claimToken: string;
  attemptCount: number;
};

export type ReplayDispatchReport = {
  claimed: number;
  published: number;
  failed: number;
};

/** Publishes only durable replay commands; PostgreSQL remains authoritative. */
@Injectable()
export class ReplayDispatcher {
  private readonly queues = new Map<
    string,
    ReturnType<QueueFactory['create']>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly queuesFactory: QueueFactory,
    private readonly jobContext: AsyncJobContextService,
    private readonly requestContext: RequestContextService,
    private readonly logger: ApplicationLogger,
    private readonly config: ConfigService,
  ) {}

  async dispatchBatch(): Promise<ReplayDispatchReport> {
    const token = randomUUID();
    const rows = await this.claim(
      this.positive('ASYNC_REPLAY_BATCH_SIZE', DEFAULT_BATCH_SIZE),
      this.positive('ASYNC_REPLAY_LEASE_SECONDS', DEFAULT_LEASE_SECONDS),
      token,
    );
    let published = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await this.publish(row);
        await this.acknowledge(row.id, row.claimToken);
        published += 1;
      } catch (error: unknown) {
        failed += 1;
        this.logger.warn(
          {
            module: 'async-recovery',
            operation: 'replay_publication_failed',
            replayId: row.id,
          },
          error instanceof Error ? error.message : 'Replay publication failed',
        );
      }
    }
    return { claimed: rows.length, published, failed };
  }

  private async claim(
    batchSize: number,
    leaseSeconds: number,
    token: string,
  ): Promise<ClaimedReplay[]> {
    return this.prisma.$queryRaw<ClaimedReplay[]>(Prisma.sql`
      WITH candidates AS (
        SELECT replay."id"
        FROM "AsyncReplay" replay
        WHERE (
          replay."status" = 'REQUESTED'
          OR (replay."status" = 'CLAIMED' AND replay."leaseExpiresAt" <= CURRENT_TIMESTAMP)
        )
        ORDER BY replay."createdAt" ASC, replay."id" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "AsyncReplay" replay
      SET "status" = 'CLAIMED', "claimToken" = CAST(${token} AS UUID),
          "claimedAt" = CURRENT_TIMESTAMP,
          "leaseExpiresAt" = CURRENT_TIMESTAMP + (${leaseSeconds} * INTERVAL '1 second'),
          "attemptCount" = replay."attemptCount" + 1,
          "lastAttemptAt" = CURRENT_TIMESTAMP
      FROM candidates, "AsyncFailure" failure, "OutboxEvent" event
      WHERE replay."id" = candidates."id"
        AND replay."failureId" = failure."id"
        AND failure."outboxEventId" = event."id"
        AND failure."quarantinedAt" IS NULL
        AND failure."dismissedAt" IS NULL
      RETURNING replay."id", replay."failureId", failure."outboxEventId", replay."deterministicJobId",
        failure."queueName", failure."jobName", failure."eventType", failure."eventVersion",
        failure."correlationId", event."occurredAt", event."payload",
        replay."claimToken", replay."attemptCount"
    `);
  }

  private async publish(row: ClaimedReplay): Promise<void> {
    if (
      typeof row.payload !== 'object' ||
      row.payload === null ||
      Array.isArray(row.payload)
    )
      throw new Error('Replay source payload is invalid.');
    await this.requestContext.run(
      { requestId: `replay_${row.id}`, correlationId: row.correlationId },
      async () => {
        const envelope = this.jobContext.createEnvelope({
          replayId: row.id,
          failureId: row.failureId,
          outboxEventId: row.outboxEventId,
          eventType: row.eventType,
          eventVersion: row.eventVersion,
          occurredAt: row.occurredAt.toISOString(),
          payload: row.payload as OutboxPayload,
        });
        await this.queue(row.queueName).add(row.jobName, envelope, {
          jobId: row.deterministicJobId,
        });
      },
    );
  }

  private async acknowledge(id: string, token: string): Promise<void> {
    const result = await this.prisma.asyncReplay.updateMany({
      where: { id, status: 'CLAIMED', claimToken: token },
      data: {
        status: 'PUBLISHED',
        claimToken: null,
        claimedAt: null,
        leaseExpiresAt: null,
      },
    });
    if (result.count !== 1)
      throw new Error('Replay acknowledgement lost claim.');
  }

  private queue(name: string): ReturnType<QueueFactory['create']> {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = this.queuesFactory.create(name);
      this.queues.set(name, queue);
    }
    return queue;
  }

  private positive(name: string, fallback: number): number {
    const value = this.config.get<number>(name);
    return typeof value === 'number' && Number.isInteger(value) && value > 0
      ? value
      : fallback;
  }
}

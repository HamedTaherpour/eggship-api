import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../../generated/prisma/client';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { RequestContextService } from '../../../common/observability/request-context.service';
import { AsyncJobContextService } from '../../../infrastructure/queue/async-job-context.service';
import { QueueFactory } from '../../../infrastructure/queue/queue.factory';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { OutboxPayload } from '../domain/outbox-event';

export const OUTBOX_QUEUE_NAME = 'outbox-events';
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_LEASE_SECONDS = 60;
const DEFAULT_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

interface ClaimedOutboxEvent {
  id: string;
  eventType: string;
  eventVersion: number;
  correlationId: string;
  occurredAt: Date;
  payload: Prisma.JsonValue;
  attemptCount: number;
}

export interface OutboxDispatchReport {
  claimed: number;
  published: number;
  failed: number;
}

interface OutboxJobData {
  outboxEventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  payload: OutboxPayload;
}

@Injectable()
export class OutboxDispatcher {
  private queue: ReturnType<QueueFactory['create']> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueFactory: QueueFactory,
    private readonly jobContext: AsyncJobContextService,
    private readonly requestContext: RequestContextService,
    private readonly logger: ApplicationLogger,
    private readonly config: ConfigService,
  ) {}

  async dispatchBatch(): Promise<OutboxDispatchReport> {
    const batchSize = this.positiveConfig(
      'OUTBOX_BATCH_SIZE',
      DEFAULT_BATCH_SIZE,
    );
    const concurrency = this.positiveConfig(
      'OUTBOX_CONCURRENCY',
      DEFAULT_CONCURRENCY,
    );
    const leaseSeconds = this.positiveConfig(
      'OUTBOX_LEASE_SECONDS',
      DEFAULT_LEASE_SECONDS,
    );
    const claimToken = randomUUID();
    const events = await this.claim(batchSize, leaseSeconds, claimToken);
    this.logger.info(
      {
        module: 'outbox',
        operation: 'batch_claimed',
        outboxEventCount: events.length,
        claimToken,
      },
      'Transactional outbox batch claimed',
    );

    let published = 0;
    let failed = 0;
    let cursor = 0;
    const publishOne = async (): Promise<void> => {
      while (cursor < events.length) {
        const event = events[cursor];
        cursor += 1;
        if (event === undefined) return;
        try {
          await this.publish(event);
          await this.acknowledge(event.id, claimToken, event.eventType);
          published += 1;
        } catch (error: unknown) {
          failed += 1;
          await this.release(event, claimToken, error);
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, events.length) }, () =>
        publishOne(),
      ),
    );
    return { claimed: events.length, published, failed };
  }

  private async claim(
    batchSize: number,
    leaseSeconds: number,
    claimToken: string,
  ): Promise<ClaimedOutboxEvent[]> {
    return this.prisma.$queryRaw<ClaimedOutboxEvent[]>(Prisma.sql`
      WITH candidates AS (
        SELECT "id"
        FROM "OutboxEvent"
        WHERE (
          "state" = 'PENDING'
          OR ("state" = 'CLAIMED' AND "leaseExpiresAt" <= CURRENT_TIMESTAMP)
        )
        AND "nextAttemptAt" <= CURRENT_TIMESTAMP
        ORDER BY "createdAt" ASC, "id" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "OutboxEvent" AS event
      SET "state" = 'CLAIMED',
          "claimToken" = CAST(${claimToken} AS UUID),
          "claimedAt" = CURRENT_TIMESTAMP,
          "leaseExpiresAt" = CURRENT_TIMESTAMP + (${leaseSeconds} * INTERVAL '1 second'),
          "attemptCount" = "attemptCount" + 1
      FROM candidates
      WHERE event."id" = candidates."id"
      RETURNING event."id", event."eventType", event."eventVersion", event."correlationId",
        event."occurredAt", event."payload", event."attemptCount"
    `);
  }

  private async publish(event: ClaimedOutboxEvent): Promise<void> {
    const payload = this.asPayload(event.payload);
    await this.requestContext.run(
      { requestId: `outbox_${event.id}`, correlationId: event.correlationId },
      async () => {
        const envelope = this.jobContext.createEnvelope<OutboxJobData>({
          outboxEventId: event.id,
          eventType: event.eventType,
          eventVersion: event.eventVersion,
          occurredAt: event.occurredAt.toISOString(),
          payload,
        });
        await this.getQueue().add(event.eventType, envelope, {
          jobId: `outbox-${event.id}`,
        });
      },
    );
    this.logger.info(
      {
        module: 'outbox',
        operation: 'publication_succeeded',
        outboxEventId: event.id,
        eventType: event.eventType,
        attemptCount: event.attemptCount,
      },
      'Transactional outbox event accepted by BullMQ',
    );
  }

  private async acknowledge(
    id: string,
    claimToken: string,
    eventType: string,
  ): Promise<void> {
    const result = await this.prisma.outboxEvent.updateMany({
      where: { id, state: 'CLAIMED', claimToken },
      data: {
        state: 'PUBLISHED',
        publishedAt: new Date(),
        claimToken: null,
        claimedAt: null,
        leaseExpiresAt: null,
      },
    });
    if (result.count !== 1) {
      throw new Error(`Outbox acknowledgement lost claim for '${id}'.`);
    }
    this.logger.info(
      {
        module: 'outbox',
        operation: 'acknowledged',
        outboxEventId: id,
        eventType,
      },
      'Transactional outbox event marked published',
    );
  }

  private async release(
    event: ClaimedOutboxEvent,
    claimToken: string,
    error: unknown,
  ): Promise<void> {
    const delay = Math.min(
      MAX_BACKOFF_MS,
      DEFAULT_BACKOFF_MS * 2 ** Math.min(event.attemptCount - 1, 6),
    );
    await this.prisma.outboxEvent.updateMany({
      where: { id: event.id, state: 'CLAIMED', claimToken },
      data: {
        state: 'PENDING',
        nextAttemptAt: new Date(Date.now() + delay),
        claimToken: null,
        claimedAt: null,
        leaseExpiresAt: null,
      },
    });
    this.logger.warn(
      {
        module: 'outbox',
        operation: 'publication_failed_retryable',
        outboxEventId: event.id,
        eventType: event.eventType,
        attemptCount: event.attemptCount,
        retryDelayMs: delay,
      },
      error instanceof Error
        ? `Transactional outbox publication failed: ${error.message}`
        : 'Transactional outbox publication failed',
    );
  }

  private getQueue(): ReturnType<QueueFactory['create']> {
    this.queue ??= this.queueFactory.create(OUTBOX_QUEUE_NAME);
    return this.queue;
  }

  private positiveConfig(name: string, fallback: number): number {
    const value = this.config.get<number>(name);
    return typeof value === 'number' && Number.isInteger(value) && value > 0
      ? value
      : fallback;
  }

  private asPayload(value: Prisma.JsonValue): OutboxPayload {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('Outbox payload must be a JSON object.');
    }
    return value as OutboxPayload;
  }
}

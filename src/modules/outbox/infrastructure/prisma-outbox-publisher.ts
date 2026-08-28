import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import {
  resolvePrismaConnection,
  type PrismaConnection,
} from '../../../infrastructure/database/prisma/prisma-transaction-context';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { OutboxPublisher } from '../application/outbox-publisher';
import {
  assertOutboxEnvelope,
  type OutboxEventEnvelope,
  type OutboxEventRecord,
} from '../domain/outbox-event';

@Injectable()
export class PrismaOutboxPublisher extends OutboxPublisher {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  override async publish(
    envelope: OutboxEventEnvelope,
    tx: TransactionContext,
  ): Promise<OutboxEventRecord> {
    assertOutboxEnvelope(envelope);
    try {
      const row = await this.db(tx).outboxEvent.create({
        data: {
          id: envelope.eventId,
          eventType: envelope.eventType,
          eventVersion: envelope.eventVersion,
          correlationId: envelope.correlationId,
          occurredAt: envelope.occurredAt,
          payload: envelope.payload,
        },
      });
      return {
        eventId: row.id,
        eventType: row.eventType,
        eventVersion: row.eventVersion,
        correlationId: row.correlationId,
        occurredAt: row.occurredAt,
        payload: row.payload as OutboxEventEnvelope['payload'],
        state: row.state,
        publishedAt: row.publishedAt,
        createdAt: row.createdAt,
      };
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new Error(`Outbox event '${envelope.eventId}' already exists.`, {
          cause: error,
        });
      }
      throw error;
    }
  }

  private db(tx: TransactionContext): PrismaConnection {
    return resolvePrismaConnection(this.prisma, tx);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

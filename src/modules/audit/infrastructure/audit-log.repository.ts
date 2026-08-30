import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import {
  resolvePrismaConnection,
  type PrismaConnection,
} from '../../../infrastructure/database/prisma/prisma-transaction-context';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { NormalizedAuditEvent } from '../domain/audit-event';

export type AuditLogRecord = Omit<NormalizedAuditEvent, 'metadata'> & {
  metadata: Prisma.JsonValue | null;
};

/** Append-only persistence boundary. There are intentionally no update/delete APIs. */
@Injectable()
export class AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async append(
    event: NormalizedAuditEvent,
    tx?: TransactionContext,
  ): Promise<AuditLogRecord> {
    const row = await this.db(tx).auditLog.create({
      data: {
        id: event.id,
        occurredAt: event.occurredAt,
        actorType: event.actorType,
        actorId: event.actorId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        requestId: event.requestId,
        correlationId: event.correlationId,
        metadata: event.metadata === null ? Prisma.JsonNull : event.metadata,
      },
    });
    return { ...event, metadata: row.metadata };
  }

  private db(tx: TransactionContext | undefined): PrismaConnection {
    return resolvePrismaConnection(this.prisma, tx);
  }
}

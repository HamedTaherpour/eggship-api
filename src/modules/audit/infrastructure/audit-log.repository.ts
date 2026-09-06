import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import {
  resolvePrismaConnection,
  type PrismaConnection,
} from '../../../infrastructure/database/prisma/prisma-transaction-context';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { NormalizedAuditEvent } from '../domain/audit-event';
import type { AuditLogListQuery } from '../domain/audit-log-query';

export type AuditLogRecord = Omit<NormalizedAuditEvent, 'metadata'> & {
  metadata: Prisma.JsonValue | null;
};

export type AuditLogReadRecord = {
  id: string;
  occurredAt: Date;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  requestId: string | null;
  correlationId: string | null;
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
    const metadata =
      event.metadata === null ? null : JSON.stringify(event.metadata);
    const rows = await this.db(tx).$queryRaw<AuditLogReadRecord[]>(Prisma.sql`
      INSERT INTO "AuditLog" (
        "id", "actorType", "actorId", "action", "entityType", "entityId",
        "requestId", "correlationId", "metadata", "occurredAt"
      )
      VALUES (
        ${event.id}::uuid, ${event.actorType}, ${event.actorId}::uuid,
        ${event.action}, ${event.entityType}, ${event.entityId}::uuid,
        ${event.requestId}, ${event.correlationId},
        ${metadata}::jsonb, CURRENT_TIMESTAMP
      )
      RETURNING "id", "occurredAt", "actorType", "actorId", "action",
        "entityType", "entityId", "requestId", "correlationId", "metadata"
    `);
    const row = rows[0]!;
    return { ...event, occurredAt: row.occurredAt, metadata: row.metadata };
  }

  async findById(id: string): Promise<AuditLogReadRecord | null> {
    const row = await this.prisma.auditLog.findUnique({ where: { id } });
    return row === null ? null : mapAuditLog(row);
  }

  async list(
    query: AuditLogListQuery,
  ): Promise<{ items: AuditLogReadRecord[]; total: number }> {
    const where: Prisma.AuditLogWhereInput = {};
    if (query.action !== undefined) where.action = query.action;
    if (query.entityType !== undefined) where.entityType = query.entityType;
    if (query.entityId !== undefined) where.entityId = query.entityId;
    if (query.actorType !== undefined) where.actorType = query.actorType;
    if (query.actorId !== undefined) where.actorId = query.actorId;
    if (query.requestId !== undefined) where.requestId = query.requestId;
    if (query.correlationId !== undefined)
      where.correlationId = query.correlationId;
    if (query.occurredFrom !== undefined || query.occurredTo !== undefined) {
      where.occurredAt = {
        ...(query.occurredFrom === undefined
          ? {}
          : { gte: query.occurredFrom }),
        ...(query.occurredTo === undefined ? {} : { lte: query.occurredTo }),
      };
    }
    const skip = (query.page - 1) * query.pageSize;
    const order = query.sortOrder;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ occurredAt: order }, { id: order }],
        skip,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(mapAuditLog), total };
  }

  private db(tx: TransactionContext | undefined): PrismaConnection {
    return resolvePrismaConnection(this.prisma, tx);
  }
}

function mapAuditLog(row: {
  id: string;
  occurredAt: Date;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  requestId: string | null;
  correlationId: string | null;
  metadata: Prisma.JsonValue;
}): AuditLogReadRecord {
  return { ...row };
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import {
  resolvePrismaConnection,
  type PrismaConnection,
} from '../../../infrastructure/database/prisma/prisma-transaction-context';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import {
  normalizeNotificationInput,
  assertNotificationUuid,
  NotificationInvalidUserError,
  type CreateNotificationInput,
  type NotificationRecord,
} from '../domain/notification';
import {
  toSkipTake,
  type PageResult,
  type PageRequest,
} from '../../../common/list';

export type NotificationListQuery = PageRequest;

@Injectable()
export class NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    input: CreateNotificationInput,
    tx?: TransactionContext,
  ): Promise<NotificationRecord> {
    const normalized = normalizeNotificationInput(input);
    try {
      const row = await this.db(tx).notification.create({
        data: {
          ...(normalized.notificationId === undefined
            ? {}
            : { id: normalized.notificationId }),
          userId: normalized.userId,
          type: normalized.type,
          source: normalized.source,
          title: normalized.title,
          body: normalized.body,
          payload: normalized.payload,
        },
      });
      return mapNotification(row);
    } catch (error: unknown) {
      if (isForeignKeyViolation(error))
        throw new NotificationInvalidUserError();
      throw error;
    }
  }

  /** Missing and other-owner rows both return null, preventing BOLA leakage. */
  async findOwnedById(
    notificationId: string,
    userId: string,
    tx?: TransactionContext,
  ): Promise<NotificationRecord | null> {
    const id = assertNotificationUuid(notificationId, 'notificationId');
    const owner = assertNotificationUuid(userId, 'userId');
    const row = await this.db(tx).notification.findFirst({
      where: { id, userId: owner },
    });
    return row === null ? null : mapNotification(row);
  }

  async findById(id: string): Promise<NotificationRecord | null> {
    const row = await this.prisma.notification.findUnique({ where: { id } });
    return row === null ? null : mapNotification(row);
  }

  /** Idempotent owner-scoped read transition. */
  async markReadForOwner(
    notificationId: string,
    userId: string,
    tx?: TransactionContext,
  ): Promise<NotificationRecord | null> {
    const id = assertNotificationUuid(notificationId, 'notificationId');
    const owner = assertNotificationUuid(userId, 'userId');
    await this.db(tx).notification.updateMany({
      where: { id, userId: owner, readAt: null },
      data: { readAt: new Date() },
    });
    return this.findOwnedById(id, owner, tx);
  }

  async listOwned(
    userId: string,
    query: NotificationListQuery,
    tx?: TransactionContext,
  ): Promise<PageResult<NotificationRecord>> {
    const owner = assertNotificationUuid(userId, 'userId');
    const { skip, take } = toSkipTake(query);
    const connection = this.db(tx);
    const [rows, total] = await Promise.all([
      connection.notification.findMany({
        where: { userId: owner },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
      connection.notification.count({ where: { userId: owner } }),
    ]);
    return { items: rows.map(mapNotification), total };
  }

  async countUnreadForOwner(userId: string): Promise<number> {
    const owner = assertNotificationUuid(userId, 'userId');
    return this.prisma.notification.count({
      where: { userId: owner, readAt: null },
    });
  }

  async markAllReadForOwner(userId: string): Promise<number> {
    const owner = assertNotificationUuid(userId, 'userId');
    const result = await this.prisma.notification.updateMany({
      where: { userId: owner, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  private db(tx?: TransactionContext): PrismaConnection {
    return resolvePrismaConnection(this.prisma, tx);
  }
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2003'
  );
}

function mapNotification(row: {
  id: string;
  userId: string;
  type: string;
  source: string;
  title: string;
  body: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
  readAt: Date | null;
  pushDeliveriesMaterializedAt: Date | null;
}): NotificationRecord {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type as NotificationRecord['type'],
    source: row.source as NotificationRecord['source'],
    title: row.title,
    body: row.body,
    payload: row.payload as NotificationRecord['payload'],
    createdAt: row.createdAt,
    readAt: row.readAt,
    pushDeliveriesMaterializedAt: row.pushDeliveriesMaterializedAt,
  };
}

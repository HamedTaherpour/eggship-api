import { Injectable } from '@nestjs/common';
import {
  resolvePageRequest,
  toPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/list';
import type { NotificationListQueryDto } from '../api/dto/notification-list-query.dto';
import { NotificationNotFoundError } from '../domain/notification-errors';
import type { NotificationRecord } from '../domain/notification';
import { NotificationRepository } from '../infrastructure/notification.repository';

@Injectable()
export class NotificationInboxService {
  constructor(private readonly notifications: NotificationRepository) {}

  async listOwned(
    userId: string,
    query: NotificationListQueryDto,
  ): Promise<PaginatedResponse<NotificationRecord>> {
    const page = resolvePageRequest(query);
    const result = await this.notifications.listOwned(userId, page);
    return toPaginatedResponse(result.items, page, result.total);
  }

  countUnread(userId: string): Promise<number> {
    return this.notifications.countUnreadForOwner(userId);
  }

  async markRead(
    userId: string,
    notificationId: string,
  ): Promise<NotificationRecord> {
    const found = await this.notifications.markReadForOwner(
      notificationId,
      userId,
    );
    if (found === null) throw new NotificationNotFoundError();
    return found;
  }

  markAllRead(userId: string): Promise<number> {
    return this.notifications.markAllReadForOwner(userId);
  }
}

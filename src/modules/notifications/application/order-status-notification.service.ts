import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import { OutboxPublisher } from '../../outbox/application/outbox-publisher';
import { NotificationSource, NotificationType } from '../domain/notification';
import { NotificationRepository } from '../infrastructure/notification.repository';

const ORDER_STATUS_EVENT_TYPE = 'order.status.changed';
const ORDER_STATUS_EVENT_VERSION = 1;
const APPROVED_STATUSES = new Set([
  'CONFIRMED',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
]);

export interface OrderStatusNotificationInput {
  orderId: string;
  userId: string;
  status: string;
  occurredAt: Date;
}

/** NOT-03 durable inbox generation and ASY-01 intent recording. */
@Injectable()
export class OrderStatusNotificationService {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly outbox: OutboxPublisher,
  ) {}

  async generate(
    input: OrderStatusNotificationInput,
    tx: TransactionContext,
  ): Promise<void> {
    if (!APPROVED_STATUSES.has(input.status)) {
      throw new Error(
        'Order status is not approved for customer notification.',
      );
    }

    const eventId = deterministicEventId(input.orderId, input.status);
    await this.outbox.publish(
      {
        eventId,
        eventType: ORDER_STATUS_EVENT_TYPE,
        eventVersion: ORDER_STATUS_EVENT_VERSION,
        occurredAt: input.occurredAt,
        correlationId: `order:${input.orderId}:${input.status.toLowerCase()}`,
        payload: { orderId: input.orderId, status: input.status },
      },
      tx,
    );
    await this.notifications.create(
      {
        notificationId: eventId,
        userId: input.userId,
        type: NotificationType.ORDER_STATUS,
        source: NotificationSource.ORDER_TRANSITION,
        title: 'Order status updated',
        body: `Your order status is now ${input.status}.`,
        payload: { orderId: input.orderId, status: input.status },
      },
      tx,
    );
  }
}

function deterministicEventId(orderId: string, status: string): string {
  const digest = createHash('sha256')
    .update(`eggship:order-status:${orderId}:${status}`)
    .digest();
  digest[6] = (digest[6]! & 0x0f) | 0x40;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.toString('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

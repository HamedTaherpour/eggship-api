import { randomUUID } from 'node:crypto';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import type { OutboxPublisher } from '../../outbox/application/outbox-publisher';
import type { NotificationRepository } from '../infrastructure/notification.repository';
import { OrderStatusNotificationService } from './order-status-notification.service';

describe('OrderStatusNotificationService', () => {
  const tx = {} as TransactionContext;
  const orderId = randomUUID();
  const userId = randomUUID();
  let notifications: jest.Mocked<Pick<NotificationRepository, 'create'>>;
  let outbox: jest.Mocked<Pick<OutboxPublisher, 'publish'>>;
  let service: OrderStatusNotificationService;

  beforeEach(() => {
    notifications = { create: jest.fn() };
    outbox = { publish: jest.fn() };
    service = new OrderStatusNotificationService(
      notifications as unknown as NotificationRepository,
      outbox,
    );
  });

  it('writes a bounded event and inbox record through the caller transaction', async () => {
    const occurredAt = new Date('2026-08-28T10:00:00.000Z');
    await service.generate(
      { orderId, userId, status: 'SHIPPED', occurredAt },
      tx,
    );

    expect(outbox.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'order.status.changed',
        eventVersion: 1,
        occurredAt,
        payload: { orderId, status: 'SHIPPED' },
      }),
      tx,
    );
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        type: 'ORDER_STATUS',
        source: 'ORDER_TRANSITION',
        payload: { orderId, status: 'SHIPPED' },
      }),
      tx,
    );
  });

  it('rejects unapproved statuses before persistence', async () => {
    await expect(
      service.generate(
        { orderId, userId, status: 'RETURNED', occurredAt: new Date() },
        tx,
      ),
    ).rejects.toThrow('not approved');
    expect(outbox.publish).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });
});

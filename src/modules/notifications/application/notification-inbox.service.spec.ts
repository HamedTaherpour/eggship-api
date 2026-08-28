import { NotificationInboxService } from './notification-inbox.service';
import type { NotificationRecord } from '../domain/notification';
import type { NotificationRepository } from '../infrastructure/notification.repository';

const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const notification: NotificationRecord = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  userId: ownerId,
  type: 'ORDER_STATUS',
  source: 'ORDER_TRANSITION',
  title: 'Order updated',
  body: 'Your order is ready.',
  payload: { orderId: 'safe-value' },
  createdAt: new Date('2026-08-28T10:00:00.000Z'),
  readAt: null,
};

describe('NotificationInboxService', () => {
  let repository: jest.Mocked<NotificationRepository>;
  let service: NotificationInboxService;

  beforeEach(() => {
    repository = {
      listOwned: jest.fn(),
      countUnreadForOwner: jest.fn(),
      markReadForOwner: jest.fn(),
      markAllReadForOwner: jest.fn(),
    } as unknown as jest.Mocked<NotificationRepository>;
    service = new NotificationInboxService(repository);
  });

  it('maps a bounded owner list to the canonical pagination envelope', async () => {
    repository.listOwned.mockResolvedValue({ items: [notification], total: 1 });

    await expect(
      service.listOwned(ownerId, { page: 2, pageSize: 1 }),
    ).resolves.toEqual({
      data: [notification],
      meta: { page: 2, pageSize: 1, total: 1, totalPages: 1 },
    });
    expect(repository.listOwned.mock.calls[0]).toEqual([
      ownerId,
      { page: 2, pageSize: 1 },
    ]);
  });

  it('returns the repository unread count for the principal owner', async () => {
    repository.countUnreadForOwner.mockResolvedValue(3);
    await expect(service.countUnread(ownerId)).resolves.toBe(3);
    expect(repository.countUnreadForOwner.mock.calls[0]).toEqual([ownerId]);
  });

  it('preserves the owner-scoped mark-read result and bulk count', async () => {
    repository.markReadForOwner.mockResolvedValue(notification);
    repository.markAllReadForOwner.mockResolvedValue(2);

    await expect(service.markRead(ownerId, notification.id)).resolves.toBe(
      notification,
    );
    await expect(service.markAllRead(ownerId)).resolves.toBe(2);
    expect(repository.markReadForOwner.mock.calls[0]).toEqual([
      notification.id,
      ownerId,
    ]);
    expect(repository.markAllReadForOwner.mock.calls[0]).toEqual([ownerId]);
  });
});

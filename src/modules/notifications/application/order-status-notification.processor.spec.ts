import type { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { NotificationType } from '../domain/notification';
import { OrderStatusNotificationProcessor } from './order-status-notification.processor';
import type { NotificationDeliveryRepository } from '../infrastructure/notification-delivery.repository';
import type { NotificationRepository } from '../infrastructure/notification.repository';
import type { PushInstallationRepository } from '../infrastructure/push-installation.repository';
import type { PushDeliveryProvider } from '../domain/push-delivery-provider';
import type { AsyncJobEnvelope } from '../../../infrastructure/queue/async-job-context.service';
import type { AsyncRecoveryService } from '../../async-recovery/application/async-recovery.service';

type TestDoubles = {
  processor: OrderStatusNotificationProcessor;
  notifications: jest.Mocked<NotificationRepository>;
  deliveries: jest.Mocked<NotificationDeliveryRepository>;
  installations: jest.Mocked<PushInstallationRepository>;
  provider: jest.Mocked<PushDeliveryProvider>;
};

const notificationId = '8f6c4d4a-4e75-4a8e-aeb8-2a6d30b7a911';
const orderId = '7c2d4f69-2a68-4c3f-b7f9-126d0f0b8b3b';

type Candidate = Awaited<
  ReturnType<NotificationDeliveryRepository['findClaimable']>
>[number];

function candidate(id: string, token: string): Candidate {
  return {
    id,
    notificationId,
    installationId: `installation-${id}`,
    channel: 'WEB_PUSH',
    state: 'PENDING',
    failureCode: null,
    attemptCount: 0,
    claimToken: null,
    claimedAt: null,
    leaseExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    providerToken: token,
    userIsActive: true,
    installationStatus: 'ACTIVE',
    permissionGranted: true,
  };
}

function job(data: unknown): Job<AsyncJobEnvelope<unknown>> {
  return { data: { data } } as unknown as Job<AsyncJobEnvelope<unknown>>;
}

function notification(): NonNullable<
  Awaited<ReturnType<NotificationRepository['findById']>>
> {
  return {
    id: notificationId,
    userId: 'b54d6b75-84c7-4e69-a1df-0f4c8af00c86',
    type: NotificationType.ORDER_STATUS,
    source: 'ORDER_TRANSITION' as const,
    title: 'Order status updated',
    body: 'Your order status is now SHIPPED.',
    payload: { orderId, status: 'SHIPPED' },
    createdAt: new Date(),
    readAt: null,
    pushDeliveriesMaterializedAt: new Date(),
  };
}

describe('OrderStatusNotificationProcessor', () => {
  function setup(): TestDoubles {
    const notifications = {
      findById: jest.fn().mockResolvedValue(notification()),
    } as unknown as jest.Mocked<NotificationRepository>;
    const deliveries = {
      materializeOnce: jest.fn(),
      findClaimable: jest.fn().mockResolvedValue([]),
      claim: jest.fn(),
      complete: jest.fn().mockResolvedValue(true),
      isEligible: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<NotificationDeliveryRepository>;
    const installations = {
      invalidate: jest.fn(),
    } as unknown as jest.Mocked<PushInstallationRepository>;
    const provider = {
      send: jest.fn(),
    } as unknown as jest.Mocked<PushDeliveryProvider>;
    const recovery = {
      beginReplayExecution: jest.fn(),
      recordReplayResult: jest.fn(),
    } as unknown as jest.Mocked<AsyncRecoveryService>;
    const processor = new OrderStatusNotificationProcessor(
      notifications,
      deliveries,
      installations,
      provider,
      recovery,
      new ConfigService({ APP_VERSION: '0.1.0' }),
    );
    return { processor, notifications, deliveries, installations, provider };
  }

  it('rejects invalid UUIDs before resolving persistence records', async () => {
    const { processor, notifications } = setup();
    await expect(
      processor.process(
        job({
          outboxEventId: 'not-a-uuid',
          eventType: 'order.status.changed',
          eventVersion: 1,
          occurredAt: new Date().toISOString(),
          payload: { orderId, status: 'SHIPPED' },
        }),
      ),
    ).rejects.toMatchObject({ category: 'INVALID_PAYLOAD' });
    expect(notifications.findById.mock.calls).toHaveLength(0);
  });

  it('keeps accepted, transient, invalid-token, and suppressed devices independent', async () => {
    const { processor, deliveries, installations, provider } = setup();
    const devices = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      candidate(id, `token-${id}`),
    );
    deliveries.findClaimable.mockResolvedValue(devices);
    deliveries.claim
      .mockResolvedValueOnce({ claimToken: 'claim-a', attemptCount: 1 })
      .mockResolvedValueOnce({ claimToken: 'claim-b', attemptCount: 1 })
      .mockResolvedValueOnce({ claimToken: 'claim-c', attemptCount: 1 })
      .mockResolvedValueOnce({ claimToken: 'claim-d', attemptCount: 1 })
      .mockResolvedValueOnce({ claimToken: 'claim-e', attemptCount: 1 });
    provider.send
      .mockResolvedValueOnce({ kind: 'accepted' })
      .mockResolvedValueOnce({ kind: 'accepted' })
      .mockResolvedValueOnce({ kind: 'failed', code: 'TRANSIENT' })
      .mockResolvedValueOnce({ kind: 'failed', code: 'INVALID_TOKEN' });
    devices[4]!.userIsActive = false;

    await expect(
      processor.process(
        job({
          outboxEventId: notificationId,
          eventType: 'order.status.changed',
          eventVersion: 1,
          occurredAt: new Date().toISOString(),
          payload: { orderId, status: 'SHIPPED' },
        }),
      ),
    ).rejects.toMatchObject({
      category: 'PROVIDER_TRANSIENT',
      retryable: true,
    });

    expect(provider.send.mock.calls).toHaveLength(4);
    expect(installations.invalidate.mock.calls).toContainEqual([
      devices[3]!.installationId,
    ]);
    expect(deliveries.complete.mock.calls).toContainEqual([
      devices[4]!.id,
      'claim-e',
      'SUPPRESSED',
    ]);
  });
});

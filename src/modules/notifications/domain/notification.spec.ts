import {
  normalizeNotificationInput,
  NotificationSource,
  NotificationType,
} from './notification';
import type {
  CreateNotificationInput,
  NotificationPayload,
} from './notification';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function input(
  overrides: Partial<CreateNotificationInput> = {},
): CreateNotificationInput {
  return {
    userId,
    type: NotificationType.ORDER_STATUS,
    source: NotificationSource.ORDER_TRANSITION,
    title: '  Order updated  ',
    body: '  Your order is on its way.  ',
    payload: { orderId: userId },
    ...overrides,
  };
}

function invalid(value: unknown): void {
  normalizeNotificationInput(value as CreateNotificationInput);
}

describe('notification domain validation', () => {
  it('normalizes bounded display text while preserving safe payload data', () => {
    expect(normalizeNotificationInput(input())).toMatchObject({
      title: 'Order updated',
      body: 'Your order is on its way.',
      payload: { orderId: userId },
    });
  });

  it('rejects an unknown type', () => {
    expect(() => invalid({ ...input(), type: 'UNCONTROLLED' })).toThrow();
  });

  it('rejects invalid display text and payload shapes', () => {
    expect(() => invalid({ ...input(), title: ' ' })).toThrow();
    expect(() => invalid({ ...input(), body: 'x'.repeat(2_001) })).toThrow();
    expect(() => invalid({ ...input(), payload: [] })).toThrow();
    expect(() =>
      invalid({ ...input(), payload: { accessToken: 'secret' } }),
    ).toThrow();
  });

  it('rejects oversized structured payloads', () => {
    const payload: NotificationPayload = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [
        `field${index}`,
        'x'.repeat(512),
      ]),
    );
    expect(() => normalizeNotificationInput(input({ payload }))).toThrow(
      'size limit',
    );
  });
});

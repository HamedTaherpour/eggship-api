import { ConfigService } from '@nestjs/config';
import { FcmPushDeliveryProvider } from './fcm-push-delivery.provider';
import type { PushDeliveryMessage } from '../domain/push-delivery-provider';

const mockSend = jest.fn();
jest.mock('firebase-admin/app', () => ({
  cert: jest.fn((value: unknown) => value),
  getApps: jest.fn(() => [{ name: 'test-app' }]),
  initializeApp: jest.fn(),
}));
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(() => ({ send: mockSend })),
}));

const config = new ConfigService({
  FCM_PROJECT_ID: 'test-project',
  FCM_CLIENT_EMAIL: 'worker@test-project.iam.gserviceaccount.com',
  FCM_PRIVATE_KEY:
    '-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----',
});

function message(): PushDeliveryMessage {
  return {
    notificationId: '8f6c4d4a-4e75-4a8e-aeb8-2a6d30b7a911',
    installationId: 'opaque-installation',
    title: 'Order status updated',
    body: 'Your order status is now SHIPPED.',
    metadata: { version: 1, destination: { type: 'ORDER', id: 'order-1' } },
  };
}

describe('FcmPushDeliveryProvider', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it.each([
    ['messaging/registration-token-not-registered', 'INVALID_TOKEN'],
    ['messaging/unavailable', 'TRANSIENT'],
    ['messaging/quota-exceeded', 'RATE_LIMITED'],
    ['messaging/authentication-error', 'PROVIDER_CONFIGURATION'],
    ['messaging/invalid-argument', 'MALFORMED_PAYLOAD'],
    ['unexpected-provider-error', 'UNKNOWN'],
  ])(
    'maps %s to %s without exposing provider details',
    async (code, expected) => {
      mockSend.mockRejectedValueOnce({
        code,
        message: `secret-token ${code}`,
      });
      const result = await new FcmPushDeliveryProvider(config).send(
        'secret-token',
        message(),
      );
      expect(result).toEqual({ kind: 'failed', code: expected });
      expect(JSON.stringify(result)).not.toContain('secret-token');
      expect(JSON.stringify(result)).not.toContain(code);
      expect(mockSend).toHaveBeenCalledTimes(1);
    },
  );

  it('accepts a send and does not retry internally', async () => {
    mockSend.mockResolvedValueOnce('projects/test/messages/123');
    await expect(
      new FcmPushDeliveryProvider(config).send('opaque-token', message()),
    ).resolves.toEqual({ kind: 'accepted' });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('normalizes malformed runtime payloads without calling Firebase', async () => {
    const malformed = {
      ...message(),
      metadata: null,
    } as unknown as PushDeliveryMessage;
    await expect(
      new FcmPushDeliveryProvider(config).send('opaque-token', malformed),
    ).resolves.toEqual({ kind: 'failed', code: 'MALFORMED_PAYLOAD' });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('normalizes a wholly malformed runtime message without throwing', async () => {
    await expect(
      new FcmPushDeliveryProvider(config).send(
        'opaque-token',
        null as unknown as PushDeliveryMessage,
      ),
    ).resolves.toEqual({ kind: 'failed', code: 'MALFORMED_PAYLOAD' });
    expect(mockSend).not.toHaveBeenCalled();
  });
});

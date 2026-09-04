import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Message } from 'firebase-admin/messaging';
import type {
  PushDeliveryMessage,
  PushDeliveryProvider,
  PushDeliveryResult,
} from '../domain/push-delivery-provider';

@Injectable()
export class FcmPushDeliveryProvider implements PushDeliveryProvider {
  private readonly app: App;

  constructor(config: ConfigService) {
    const projectId = config.getOrThrow<string>('FCM_PROJECT_ID');
    const clientEmail = config.getOrThrow<string>('FCM_CLIENT_EMAIL');
    const privateKey = config
      .getOrThrow<string>('FCM_PRIVATE_KEY')
      .replace(/\\n/g, '\n');
    this.app =
      getApps()[0] ??
      initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }),
      });
  }

  async send(
    providerToken: string,
    message: PushDeliveryMessage,
  ): Promise<PushDeliveryResult> {
    try {
      if (!isValidMessage(providerToken, message))
        return { kind: 'failed', code: 'MALFORMED_PAYLOAD' };
      const payload: Message = {
        token: providerToken,
        notification: { title: message.title, body: message.body },
        data: {
          notificationId: message.notificationId,
          event: 'order.status.changed',
          version: String(message.metadata.version),
          destinationType: message.metadata.destination?.type ?? 'ORDER',
          destinationId: message.metadata.destination?.id ?? '',
        },
      };
      await getMessaging(this.app).send(payload);
      return { kind: 'accepted' };
    } catch (error: unknown) {
      return { kind: 'failed', code: classifyFcmError(error) };
    }
  }
}

function isValidMessage(
  providerToken: unknown,
  message: unknown,
): message is PushDeliveryMessage {
  if (
    typeof providerToken !== 'string' ||
    providerToken.trim() === '' ||
    typeof message !== 'object' ||
    message === null
  )
    return false;
  const candidate = message as Record<string, unknown>;
  const metadata = candidate.metadata;
  if (
    typeof candidate.notificationId !== 'string' ||
    candidate.notificationId.trim() === '' ||
    typeof candidate.installationId !== 'string' ||
    candidate.installationId.trim() === '' ||
    typeof candidate.title !== 'string' ||
    candidate.title.trim() === '' ||
    typeof candidate.body !== 'string' ||
    candidate.body.trim() === '' ||
    typeof metadata !== 'object' ||
    metadata === null
  )
    return false;
  const metadataRecord = metadata as Record<string, unknown>;
  const destination = metadataRecord.destination;
  const destinationRecord =
    typeof destination === 'object' && destination !== null
      ? (destination as Record<string, unknown>)
      : undefined;
  return (
    metadataRecord.version === 1 &&
    (destination === undefined ||
      (destinationRecord?.type === 'ORDER' &&
        typeof destinationRecord.id === 'string' &&
        destinationRecord.id.trim() !== ''))
  );
}

function classifyFcmError(
  error: unknown,
): Exclude<PushDeliveryResult, { kind: 'accepted' }>['code'] {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : '';
  if (
    code.includes('registration-token-not-registered') ||
    code.includes('invalid-registration-token')
  )
    return 'INVALID_TOKEN';
  if (code.includes('quota-exceeded') || code.includes('too-many-messages'))
    return 'RATE_LIMITED';
  if (code.includes('invalid-argument')) return 'MALFORMED_PAYLOAD';
  if (
    code.includes('authentication') ||
    code.includes('credential') ||
    code.includes('sender-id-mismatch')
  )
    return 'PROVIDER_CONFIGURATION';
  if (
    code.includes('unavailable') ||
    code.includes('internal') ||
    code.includes('deadline')
  )
    return 'TRANSIENT';
  return 'UNKNOWN';
}

export const PushDeliveryFailureCode = {
  INVALID_TOKEN: 'INVALID_TOKEN',
  TRANSIENT: 'TRANSIENT',
  RATE_LIMITED: 'RATE_LIMITED',
  PROVIDER_CONFIGURATION: 'PROVIDER_CONFIGURATION',
  MALFORMED_PAYLOAD: 'MALFORMED_PAYLOAD',
  UNKNOWN: 'UNKNOWN',
} as const;
export type PushDeliveryFailureCode =
  (typeof PushDeliveryFailureCode)[keyof typeof PushDeliveryFailureCode];

export interface PushDeliveryMessage {
  notificationId: string;
  installationId: string;
  title: string;
  body: string;
  metadata: { version: 1; destination?: { type: 'ORDER'; id: string } };
}

export type PushDeliveryResult =
  { kind: 'accepted' } | { kind: 'failed'; code: PushDeliveryFailureCode };

export interface PushDeliveryProvider {
  /** The opaque token is a call argument, never part of the message metadata. */
  send(
    providerToken: string,
    message: PushDeliveryMessage,
  ): Promise<PushDeliveryResult>;
}
export const PUSH_DELIVERY_PROVIDER = Symbol('PUSH_DELIVERY_PROVIDER');

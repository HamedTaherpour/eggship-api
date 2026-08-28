export const OUTBOX_EVENT_TYPE_MAX_LENGTH = 100;
export const OUTBOX_CORRELATION_ID_MAX_LENGTH = 128;
export const OUTBOX_PAYLOAD_LIMIT_BYTES = 65_536;
export const OUTBOX_EVENT_VERSION_MAX = 2_147_483_647;

export type OutboxJsonValue =
  | string
  | number
  | boolean
  | null
  | OutboxJsonValue[]
  | { [key: string]: OutboxJsonValue };

export type OutboxPayload = { [key: string]: OutboxJsonValue };

export interface OutboxEventEnvelope {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: Date;
  correlationId: string;
  payload: OutboxPayload;
}

export interface OutboxEventRecord extends OutboxEventEnvelope {
  state: 'PENDING' | 'CLAIMED' | 'PUBLISHED';
  publishedAt: Date | null;
  createdAt: Date;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9._-]*$/u;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  'authorization',
  'cookie',
  'setcookie',
  'password',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'databaseurl',
  'redisurl',
  'otp',
  'email',
  'phone',
  'address',
]);

export function assertOutboxEnvelope(
  envelope: OutboxEventEnvelope,
): OutboxEventEnvelope {
  if (!UUID_PATTERN.test(envelope.eventId)) {
    throw new Error('Outbox eventId must be a UUID.');
  }
  if (
    envelope.eventType.length === 0 ||
    envelope.eventType.length > OUTBOX_EVENT_TYPE_MAX_LENGTH ||
    !EVENT_TYPE_PATTERN.test(envelope.eventType)
  ) {
    throw new Error('Outbox eventType is invalid.');
  }
  if (
    !Number.isSafeInteger(envelope.eventVersion) ||
    envelope.eventVersion < 1 ||
    envelope.eventVersion > OUTBOX_EVENT_VERSION_MAX
  ) {
    throw new Error('Outbox eventVersion must be a positive integer.');
  }
  if (
    envelope.correlationId.length === 0 ||
    envelope.correlationId.length > OUTBOX_CORRELATION_ID_MAX_LENGTH ||
    !CORRELATION_ID_PATTERN.test(envelope.correlationId)
  ) {
    throw new Error('Outbox correlationId is invalid.');
  }
  if (
    !(envelope.occurredAt instanceof Date) ||
    Number.isNaN(envelope.occurredAt.getTime())
  ) {
    throw new Error('Outbox occurredAt is invalid.');
  }
  validatePayload(envelope.payload);
  const serialized = JSON.stringify(envelope.payload);
  if (Buffer.byteLength(serialized, 'utf8') > OUTBOX_PAYLOAD_LIMIT_BYTES) {
    throw new Error('Outbox payload exceeds the payload size limit.');
  }
  return envelope;
}

function validatePayload(
  value: unknown,
  key?: string,
  ancestors = new WeakSet<object>(),
): void {
  if (key !== undefined) {
    const normalizedKey = key.replace(/[^a-zA-Z0-9]/gu, '').toLowerCase();
    if (
      FORBIDDEN_PAYLOAD_KEYS.has(normalizedKey) ||
      normalizedKey.includes('password') ||
      normalizedKey.includes('secret') ||
      normalizedKey.includes('apikey') ||
      normalizedKey.includes('otp') ||
      normalizedKey.endsWith('token') ||
      normalizedKey.endsWith('email') ||
      normalizedKey.endsWith('phone') ||
      normalizedKey.endsWith('address')
    ) {
      throw new Error(`Outbox payload contains forbidden field: ${key}.`);
    }
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('Outbox payload numbers must be finite.');
    return;
  }
  if (typeof value !== 'object' || value === undefined || value === null) {
    throw new Error('Outbox payload must be JSON serializable.');
  }
  if (ancestors.has(value))
    throw new Error('Outbox payload must not be circular.');
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    !Array.isArray(value)
  ) {
    throw new Error('Outbox payload must contain plain JSON objects.');
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => validatePayload(item, undefined, ancestors));
  } else {
    Object.entries(value).forEach(([property, nestedValue]) =>
      validatePayload(nestedValue, property, ancestors),
    );
  }
  ancestors.delete(value);
}

import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RequestContextService } from '../../common/observability/request-context.service';
import { QUEUE_PAYLOAD_SIZE_LIMIT_BYTES } from './queue-options';

export interface AsyncJobMetadata {
  schemaVersion: 1;
  correlationId: string;
  enqueuedAt: string;
}

export interface AsyncJobEnvelope<Data> {
  metadata: AsyncJobMetadata;
  data: Data;
}

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
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MAX_CORRELATION_ID_LENGTH = 128;

@Injectable()
export class AsyncJobContextService {
  constructor(private readonly requestContext: RequestContextService) {}

  createEnvelope<Data>(
    data: Data,
    now: Date = new Date(),
  ): AsyncJobEnvelope<Data> {
    validatePayload(data);
    const envelope: AsyncJobEnvelope<Data> = {
      metadata: {
        schemaVersion: 1,
        correlationId: this.requestContext.getCorrelationId() ?? randomUUID(),
        enqueuedAt: now.toISOString(),
      },
      data,
    };
    if (
      Buffer.byteLength(JSON.stringify(envelope), 'utf8') >
      QUEUE_PAYLOAD_SIZE_LIMIT_BYTES
    ) {
      throw new Error('Async job envelope exceeds the payload size limit.');
    }
    return envelope;
  }

  runWithEnvelope<Result>(
    envelope: AsyncJobEnvelope<unknown>,
    callback: () => Result,
  ): Result {
    validateEnvelope(envelope);
    return this.requestContext.run(
      {
        requestId: `job_${randomUUID()}`,
        correlationId: envelope.metadata.correlationId,
      },
      callback,
    );
  }
}

function validateEnvelope(envelope: AsyncJobEnvelope<unknown>): void {
  if (
    envelope.metadata.schemaVersion !== 1 ||
    envelope.metadata.correlationId.trim() === '' ||
    envelope.metadata.correlationId.length > MAX_CORRELATION_ID_LENGTH ||
    !CORRELATION_ID_PATTERN.test(envelope.metadata.correlationId) ||
    Number.isNaN(Date.parse(envelope.metadata.enqueuedAt))
  ) {
    throw new Error('Async job envelope metadata is invalid.');
  }
  validatePayload(envelope.data);
}

function validatePayload(
  value: unknown,
  key?: string,
  ancestors: WeakSet<object> = new WeakSet<object>(),
): void {
  if (key !== undefined) {
    const normalizedKey = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (isForbiddenPayloadKey(normalizedKey)) {
      throw new Error(`Async job payload contains forbidden field: ${key}.`);
    }
    if (normalizedKey === 'user' && isRecord(value)) {
      throw new Error('Async job payloads must not contain full user objects.');
    }
  }

  if (
    value === undefined ||
    typeof value === 'bigint' ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  ) {
    throw new Error('Async job payloads must be JSON serializable.');
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Async job payloads must contain finite numbers.');
  }
  if (
    value === null ||
    ['string', 'number', 'boolean'].includes(typeof value)
  ) {
    return;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new Error('Async job payloads must not contain circular values.');
    }
    ancestors.add(value);
    value.forEach((item) => validatePayload(item, undefined, ancestors));
    ancestors.delete(value);
    return;
  }
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('Async job payloads must contain plain JSON objects.');
  }
  if (ancestors.has(value)) {
    throw new Error('Async job payloads must not contain circular values.');
  }
  ancestors.add(value);
  Object.entries(value).forEach(([property, nestedValue]) =>
    validatePayload(nestedValue, property, ancestors),
  );
  ancestors.delete(value);
}

function isForbiddenPayloadKey(normalizedKey: string): boolean {
  return (
    FORBIDDEN_PAYLOAD_KEYS.has(normalizedKey) ||
    normalizedKey.includes('password') ||
    normalizedKey.includes('secret') ||
    normalizedKey.includes('apikey') ||
    normalizedKey.includes('otp') ||
    normalizedKey.endsWith('token') ||
    normalizedKey.endsWith('email') ||
    normalizedKey.endsWith('phone') ||
    normalizedKey.endsWith('address')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

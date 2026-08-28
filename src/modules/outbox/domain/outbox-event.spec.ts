import { randomUUID } from 'node:crypto';
import {
  assertOutboxEnvelope,
  type OutboxPayload,
  type OutboxEventEnvelope,
} from './outbox-event';

function envelope(
  overrides: Partial<OutboxEventEnvelope> = {},
): OutboxEventEnvelope {
  return {
    eventId: randomUUID(),
    eventType: 'order.created',
    eventVersion: 1,
    occurredAt: new Date('2026-08-28T00:00:00.000Z'),
    correlationId: 'req_asy_01',
    payload: { orderId: randomUUID() },
    ...overrides,
  };
}

describe('outbox event envelope', () => {
  it('accepts a bounded versioned JSON object', () => {
    const value = envelope();
    expect(assertOutboxEnvelope(value)).toEqual(value);
  });

  it.each([
    ['event id', { eventId: 'not-a-uuid' }],
    ['event type', { eventType: 'Order.Created' }],
    ['event version', { eventVersion: 0 }],
    ['correlation id', { correlationId: 'bad id' }],
    ['forbidden payload field', { payload: { phone: 'redacted' } }],
  ])('rejects an invalid %s', (_name, overrides) => {
    expect(() => assertOutboxEnvelope(envelope(overrides))).toThrow();
  });

  it('rejects oversized payloads', () => {
    expect(() =>
      assertOutboxEnvelope(
        envelope({ payload: { value: 'x'.repeat(70_000) } }),
      ),
    ).toThrow('payload size limit');
  });

  it('rejects circular payloads', () => {
    const payload = {} as OutboxPayload;
    payload.self = payload;
    expect(() => assertOutboxEnvelope(envelope({ payload }))).toThrow(
      'circular',
    );
  });
});

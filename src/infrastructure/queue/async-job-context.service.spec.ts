import { AsyncJobContextService } from './async-job-context.service';
import { RequestContextService } from '../../common/observability/request-context.service';

describe('AsyncJobContextService', () => {
  const now = new Date('2026-08-20T10:00:00.000Z');

  it('creates a versioned minimal envelope with inherited correlation', () => {
    const context = new RequestContextService();
    const service = new AsyncJobContextService(context);

    const envelope = context.run(
      { requestId: 'req_1', correlationId: 'corr_1' },
      () => service.createEnvelope({ orderId: 'order_1' }, now),
    );

    expect(envelope).toEqual({
      metadata: {
        schemaVersion: 1,
        correlationId: 'corr_1',
        enqueuedAt: '2026-08-20T10:00:00.000Z',
      },
      data: { orderId: 'order_1' },
    });
  });

  it('establishes a new worker context from the envelope', () => {
    const context = new RequestContextService();
    const service = new AsyncJobContextService(context);
    const envelope = service.createEnvelope({ orderId: 'order_1' }, now);

    const observed = service.runWithEnvelope(envelope, () => context.get());

    expect(observed?.requestId).toMatch(/^job_[0-9a-f-]{36}$/);
    expect(observed?.correlationId).toBe(envelope.metadata.correlationId);
    expect(context.get()).toBeUndefined();
  });

  it('falls back to a fresh correlation id when consumed metadata is missing or invalid', () => {
    const context = new RequestContextService();
    const service = new AsyncJobContextService(context);

    const missing = service.runWithEnvelope(
      { metadata: undefined, data: { orderId: 'order_1' } } as never,
      () => context.get(),
    );
    expect(missing?.correlationId).toMatch(/^[0-9a-f-]{36}$/u);

    const invalid = service.runWithEnvelope(
      {
        metadata: {
          schemaVersion: 1,
          correlationId: 'bad correlation',
          enqueuedAt: now.toISOString(),
        },
        data: { orderId: 'order_1' },
      },
      () => context.get(),
    );
    expect(invalid?.correlationId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it.each([
    { accessToken: 'token' },
    { clientSecret: 'secret' },
    { nested: { email: 'person@example.com' } },
    { user: { id: 'user_1' } },
  ])('rejects sensitive or oversized payload shape %#', (payload) => {
    const service = new AsyncJobContextService(new RequestContextService());
    expect(() => service.createEnvelope(payload, now)).toThrow(
      /forbidden field|full user objects/,
    );
  });

  it('rejects payloads that exceed the shared size limit', () => {
    const service = new AsyncJobContextService(new RequestContextService());
    expect(() =>
      service.createEnvelope({ orderId: 'x'.repeat(65_536) }, now),
    ).toThrow('Async job envelope exceeds the payload size limit.');
  });
});

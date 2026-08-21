import { RequestContextService } from './request-context.service';

describe('RequestContextService', () => {
  it('preserves context across asynchronous boundaries', async () => {
    const service = new RequestContextService();

    await service.run(
      { requestId: 'req_async', correlationId: 'req_async' },
      async () => {
        await Promise.resolve();

        expect(service.getRequestId()).toBe('req_async');
        expect(service.getCorrelationId()).toBe('req_async');
      },
    );
  });

  it('does not expose context outside its execution scope', () => {
    const service = new RequestContextService();

    service.run({ requestId: 'req_scoped', correlationId: 'req_scoped' }, () =>
      expect(service.getRequestId()).toBe('req_scoped'),
    );

    expect(service.get()).toBeUndefined();
  });
});

import { resolveRequestId } from './request-id';

describe('resolveRequestId', () => {
  it('preserves a valid bounded inbound request ID', () => {
    expect(resolveRequestId(' req_client-123 ')).toBe('req_client-123');
  });

  it.each([
    'untrusted-id',
    'req_contains spaces',
    'req_contains,separator',
    `req_${'x'.repeat(200)}`,
  ])('replaces malformed inbound request ID %s', (inboundValue) => {
    const result = resolveRequestId(inboundValue);

    expect(result).toMatch(
      /^req_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(result).not.toBe(inboundValue);
  });
});

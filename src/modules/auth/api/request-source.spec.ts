import type { Request } from 'express';
import { resolveOtpRequestSource } from './request-source';

function requestWith(partial: {
  ip?: string;
  socket?: { remoteAddress?: string };
}): Request {
  return partial as unknown as Request;
}

describe('resolveOtpRequestSource', () => {
  it('prefers Express-resolved req.ip', () => {
    expect(
      resolveOtpRequestSource(
        requestWith({
          ip: '203.0.113.50',
          socket: { remoteAddress: '10.0.0.1' },
        }),
      ),
    ).toEqual({ clientIp: '203.0.113.50' });
  });

  it('falls back to socket remoteAddress and strips IPv4-mapped IPv6', () => {
    expect(
      resolveOtpRequestSource(
        requestWith({
          ip: undefined,
          socket: { remoteAddress: '::ffff:198.51.100.9' },
        }),
      ),
    ).toEqual({ clientIp: '198.51.100.9' });
  });

  it('does not invent an IP from empty or non-IP values', () => {
    expect(
      resolveOtpRequestSource(
        requestWith({
          ip: 'not-an-ip',
          socket: { remoteAddress: '' },
        }),
      ),
    ).toEqual({});
  });

  it('ignores X-Forwarded-For when Express/socket IP is unavailable', () => {
    const request = requestWith({
      ip: undefined,
      socket: { remoteAddress: undefined },
    }) as Request & { headers: Record<string, string> };
    request.headers = { 'x-forwarded-for': '203.0.113.99' };
    expect(resolveOtpRequestSource(request)).toEqual({});
  });
});

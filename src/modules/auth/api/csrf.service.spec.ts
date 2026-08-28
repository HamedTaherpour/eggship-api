import type { Request } from 'express';
import { CsrfService } from './csrf.service';

function service(): CsrfService {
  return new CsrfService({
    getOrThrow: (key: string) =>
      key === 'CSRF_SECRET'
        ? 'unit-csrf-secret-at-least-32-characters!!'
        : ['http://localhost:3000', 'https://admin.example.test'],
  } as never);
}

function request(headers: Record<string, string>): Request {
  return { headers } as Request;
}

describe('CsrfService', () => {
  it('issues a valid 256-bit signed token', () => {
    const csrf = service();
    const token = csrf.issue('customer');
    expect(token.split('.')).toHaveLength(2);
    expect(() =>
      csrf.validate(
        request({
          origin: 'http://localhost:3000',
          cookie: `eggship_csrf=${token}`,
          'x-csrf-token': token,
        }),
        'customer',
      ),
    ).not.toThrow();
  });

  it('rejects tampering and customer/Admin namespace substitution', () => {
    const csrf = service();
    const token = csrf.issue('customer');
    expect(() =>
      csrf.validate(
        request({
          origin: 'http://localhost:3000',
          cookie: `eggship_csrf=${token}`,
          'x-csrf-token': `${token}x`,
        }),
        'customer',
      ),
    ).toThrow('The CSRF token is invalid.');
    expect(() =>
      csrf.validate(
        request({
          origin: 'http://localhost:3000',
          cookie: `eggship_admin_csrf=${token}`,
          'x-csrf-token': token,
        }),
        'admin',
      ),
    ).toThrow('The CSRF token is invalid.');
  });

  it('uses Referer fallback and rejects cross-site Fetch Metadata', () => {
    const csrf = service();
    const token = csrf.issue('customer');
    expect(() =>
      csrf.validate(
        request({
          referer: 'http://localhost:3000/account',
          cookie: `eggship_csrf=${token}`,
          'x-csrf-token': token,
        }),
        'customer',
      ),
    ).not.toThrow();
    expect(() =>
      csrf.validate(
        request({
          origin: 'http://localhost:3000',
          'sec-fetch-site': 'cross-site',
          cookie: `eggship_csrf=${token}`,
          'x-csrf-token': token,
        }),
        'customer',
      ),
    ).toThrow('The request origin is not allowed.');
  });
});

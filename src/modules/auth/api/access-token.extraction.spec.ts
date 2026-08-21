import type { Request } from 'express';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import { extractAccessTokenFromRequest } from './access-token.extraction';

describe('extractAccessTokenFromRequest', () => {
  it('accepts Bearer-only and cookie-only tokens', () => {
    expect(
      extractAccessTokenFromRequest({
        path: '/api/v1/auth/me',
        headers: { authorization: 'Bearer only-bearer' },
      } as Request),
    ).toBe('only-bearer');

    expect(
      extractAccessTokenFromRequest({
        path: '/api/v1/auth/me',
        headers: { cookie: 'eggship_at=only-cookie' },
      } as Request),
    ).toBe('only-cookie');
  });

  it('reads Admin cookies on Admin paths and ignores storefront cookies', () => {
    expect(
      extractAccessTokenFromRequest({
        path: '/api/v1/admin/auth/me',
        headers: {
          cookie: 'eggship_admin_at=admin-cookie; eggship_at=user-cookie',
        },
      } as Request),
    ).toBe('admin-cookie');

    expect(
      extractAccessTokenFromRequest({
        path: '/api/v1/auth/me',
        headers: {
          cookie: 'eggship_admin_at=admin-cookie; eggship_at=user-cookie',
        },
      } as Request),
    ).toBe('user-cookie');
  });

  it('rejects conflicting cookie and Bearer values', () => {
    try {
      extractAccessTokenFromRequest({
        path: '/api/v1/auth/me',
        headers: {
          authorization: 'Bearer bearer-token',
          cookie: 'eggship_at=cookie-token',
        },
      } as Request);
      throw new Error('expected AuthError');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe(AuthErrorCode.INVALID_TOKEN);
    }
  });

  it('accepts identical cookie and Bearer values', () => {
    expect(
      extractAccessTokenFromRequest({
        path: '/api/v1/auth/me',
        headers: {
          authorization: 'Bearer same-token',
          cookie: 'eggship_at=same-token',
        },
      } as Request),
    ).toBe('same-token');
  });
});

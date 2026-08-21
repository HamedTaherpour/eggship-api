import type { Response } from 'express';
import {
  ACCESS_TOKEN_COOKIE_NAME,
  ADMIN_ACCESS_TOKEN_COOKIE_NAME,
  ADMIN_REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  resolveAuthCookieAttributes,
} from '../domain/auth-cookies';
import { AuthCookieWriter, readCookieValue } from './auth-cookie.writer';

function createResponse(): Response & { cookies: string[] } {
  const cookies: string[] = [];
  const headers = new Map<string, string | string[]>();
  return {
    cookies,
    setHeader(name: string, value: string | string[]): void {
      headers.set(name.toLowerCase(), value);
      if (name.toLowerCase() === 'set-cookie') {
        cookies.splice(
          0,
          cookies.length,
          ...(Array.isArray(value) ? value : [value]),
        );
      }
    },
    getHeader(name: string): string | string[] | undefined {
      return headers.get(name.toLowerCase());
    },
  } as unknown as Response & { cookies: string[] };
}

describe('AuthCookieWriter', () => {
  it('resolves Secure only in production and SameSite=Lax host-only cookies', () => {
    expect(resolveAuthCookieAttributes('development')).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
      path: '/',
      domain: undefined,
    });
    expect(resolveAuthCookieAttributes('production').secure).toBe(true);
    expect(resolveAuthCookieAttributes('production', 'admin')).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/api/v1/admin',
      domain: undefined,
    });
  });

  it('sets access and refresh cookies with aligned Max-Age and HttpOnly', () => {
    const writer = new AuthCookieWriter('development');
    const response = createResponse();

    writer.setAuthCookies(
      response,
      { accessToken: 'access.jwt', refreshToken: 'session.secret' },
      { accessTokenTtlSeconds: 900, refreshTokenMaxAgeSeconds: 3600 },
    );

    expect(response.cookies).toHaveLength(2);
    expect(response.cookies[0]).toContain(`${ACCESS_TOKEN_COOKIE_NAME}=`);
    expect(response.cookies[0]).toContain('HttpOnly');
    expect(response.cookies[0]).toContain('SameSite=Lax');
    expect(response.cookies[0]).toContain('Path=/');
    expect(response.cookies[0]).toContain('Max-Age=900');
    expect(response.cookies[0]).not.toContain('Secure');
    expect(response.cookies[0]).not.toContain('Domain=');

    expect(response.cookies[1]).toContain(`${REFRESH_TOKEN_COOKIE_NAME}=`);
    expect(response.cookies[1]).toContain('Max-Age=3600');
  });

  it('sets Secure in production', () => {
    const writer = new AuthCookieWriter('production');
    const response = createResponse();
    writer.setAccessTokenCookie(response, 'token', 60);
    expect(response.cookies[0]).toContain('Secure');
  });

  it('clears Admin cookies with Path=/api/v1/admin and Max-Age=0', () => {
    const writer = new AuthCookieWriter('production', 'admin');
    const response = createResponse();
    writer.clearAuthCookies(response);

    expect(response.cookies).toHaveLength(2);
    for (const cookie of response.cookies) {
      expect(cookie).toContain('Max-Age=0');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('Path=/api/v1/admin');
      expect(cookie).toContain('SameSite=Lax');
    }
    expect(response.cookies[0]).toContain(`${ADMIN_ACCESS_TOKEN_COOKIE_NAME}=`);
    expect(response.cookies[1]).toContain(
      `${ADMIN_REFRESH_TOKEN_COOKIE_NAME}=`,
    );
  });

  it('clears customer auth cookies with matching attributes and Max-Age=0', () => {
    const writer = new AuthCookieWriter('production');
    const response = createResponse();
    writer.clearAuthCookies(response);

    expect(response.cookies).toHaveLength(2);
    for (const cookie of response.cookies) {
      expect(cookie).toContain('Max-Age=0');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('SameSite=Lax');
    }
  });

  it('reads cookie values from the Cookie header', () => {
    expect(
      readCookieValue(
        `${ACCESS_TOKEN_COOKIE_NAME}=abc; ${REFRESH_TOKEN_COOKIE_NAME}=xyz`,
        REFRESH_TOKEN_COOKIE_NAME,
      ),
    ).toBe('xyz');
    expect(
      readCookieValue(undefined, ACCESS_TOKEN_COOKIE_NAME),
    ).toBeUndefined();
  });

  it('sets Admin cookies with a distinct name and Path', () => {
    const writer = new AuthCookieWriter('development', 'admin');
    const response = createResponse();
    writer.setAuthCookies(
      response,
      { accessToken: 'admin.jwt', refreshToken: 'admin.session.secret' },
      { accessTokenTtlSeconds: 900, refreshTokenMaxAgeSeconds: 3600 },
    );

    expect(response.cookies[0]).toContain(`${ADMIN_ACCESS_TOKEN_COOKIE_NAME}=`);
    expect(response.cookies[0]).toContain('Path=/api/v1/admin');
    expect(response.cookies[0]).not.toContain(`${ACCESS_TOKEN_COOKIE_NAME}=`);
    expect(response.cookies[1]).toContain(
      `${ADMIN_REFRESH_TOKEN_COOKIE_NAME}=`,
    );
    expect(response.cookies[1]).not.toContain('Domain=');
  });
});

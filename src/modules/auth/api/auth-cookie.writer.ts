import type { Request, Response } from 'express';
import {
  CSRF_COOKIE_NAMES,
  isAdminHttpPath,
  resolveAuthCookieAttributes,
  resolveAuthCookieNames,
  type AuthCookieAttributePolicy,
  type AuthCookieNamespace,
} from '../domain/auth-cookies';

export interface AuthCookieTtlSeconds {
  accessTokenTtlSeconds: number;
  refreshTokenMaxAgeSeconds: number;
}

/**
 * HTTP-boundary helpers for auth cookies. Controllers use these; domain
 * services must not depend on Express response objects.
 *
 * Construct one writer per cookie namespace (`customer` vs `admin`) so Admin
 * and storefront sessions cannot overwrite each other.
 */
export class AuthCookieWriter {
  private readonly attributes: AuthCookieAttributePolicy;
  private readonly names: ReturnType<typeof resolveAuthCookieNames>;

  constructor(
    nodeEnv: string,
    private readonly namespace: AuthCookieNamespace = 'customer',
  ) {
    this.attributes = resolveAuthCookieAttributes(nodeEnv, namespace);
    this.names = resolveAuthCookieNames(namespace);
  }

  setAccessTokenCookie(
    response: Response,
    token: string,
    maxAgeSeconds: number,
  ): void {
    appendSetCookie(
      response,
      serializeCookie(this.names.access, token, {
        ...this.attributes,
        maxAgeSeconds: normalizeMaxAge(maxAgeSeconds),
      }),
    );
  }

  setRefreshTokenCookie(
    response: Response,
    token: string,
    maxAgeSeconds: number,
  ): void {
    appendSetCookie(
      response,
      serializeCookie(this.names.refresh, token, {
        ...this.attributes,
        maxAgeSeconds: normalizeMaxAge(maxAgeSeconds),
      }),
    );
  }

  setAuthCookies(
    response: Response,
    tokens: { accessToken: string; refreshToken: string },
    ttl: AuthCookieTtlSeconds,
  ): void {
    this.setAccessTokenCookie(
      response,
      tokens.accessToken,
      ttl.accessTokenTtlSeconds,
    );
    this.setRefreshTokenCookie(
      response,
      tokens.refreshToken,
      ttl.refreshTokenMaxAgeSeconds,
    );
  }

  clearAuthCookies(response: Response): void {
    appendSetCookie(
      response,
      serializeCookie(this.names.access, '', {
        ...this.attributes,
        maxAgeSeconds: 0,
      }),
    );
    appendSetCookie(
      response,
      serializeCookie(this.names.refresh, '', {
        ...this.attributes,
        maxAgeSeconds: 0,
      }),
    );
  }

  readAccessToken(request: Request): string | undefined {
    return readCookieValue(request.headers.cookie, this.names.access);
  }

  readRefreshToken(request: Request): string | undefined {
    return readCookieValue(request.headers.cookie, this.names.refresh);
  }

  setCsrfCookie(response: Response, token: string): void {
    appendSetCookie(
      response,
      serializeCookie(CSRF_COOKIE_NAMES[this.namespace], token, {
        httpOnly: false,
        secure: this.attributes.secure,
        sameSite: this.attributes.sameSite,
        path: this.attributes.path,
        domain: undefined,
        maxAgeSeconds: 2_592_000,
      }),
    );
  }

  clearCsrfCookie(response: Response): void {
    appendSetCookie(
      response,
      serializeCookie(CSRF_COOKIE_NAMES[this.namespace], '', {
        httpOnly: false,
        secure: this.attributes.secure,
        sameSite: this.attributes.sameSite,
        path: this.attributes.path,
        domain: undefined,
        maxAgeSeconds: 0,
      }),
    );
  }
}

export function readCookieValue(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (cookieHeader === undefined || cookieHeader.trim() === '') {
    return undefined;
  }

  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    if (key !== name) {
      continue;
    }
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (rawValue === '') {
      return undefined;
    }
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return undefined;
}

/**
 * Resolves the access-cookie namespace from the request path so Admin and
 * customer cookies cannot substitute for each other.
 */
export function resolveAccessCookieNameForRequest(request: Request): string {
  const path = request.path || request.url || '';
  const namespace: AuthCookieNamespace = isAdminHttpPath(path)
    ? 'admin'
    : 'customer';
  return resolveAuthCookieNames(namespace).access;
}

interface SerializeCookieInput extends Omit<
  AuthCookieAttributePolicy,
  'httpOnly'
> {
  httpOnly: boolean;
  maxAgeSeconds: number;
}

function serializeCookie(
  name: string,
  value: string,
  options: SerializeCookieInput,
): string {
  const segments = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAgeSeconds}`,
    `SameSite=${options.sameSite}`,
  ];
  if (options.httpOnly) {
    segments.push('HttpOnly');
  }
  if (options.secure) {
    segments.push('Secure');
  }
  return segments.join('; ');
}

function appendSetCookie(response: Response, value: string): void {
  const existing = response.getHeader('Set-Cookie');
  if (existing === undefined) {
    response.setHeader('Set-Cookie', value);
    return;
  }
  if (Array.isArray(existing)) {
    response.setHeader('Set-Cookie', [...existing.map(String), value]);
    return;
  }
  response.setHeader('Set-Cookie', [String(existing), value]);
}

function normalizeMaxAge(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return 0;
  }
  return Math.floor(seconds);
}

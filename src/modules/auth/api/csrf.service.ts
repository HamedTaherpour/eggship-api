import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../../config/environment.validation';
import { ApplicationError } from '../../../common/errors/application-error';
import { readCookieValue } from './auth-cookie.writer';
import {
  CSRF_COOKIE_NAMES,
  type AuthCookieNamespace,
} from '../domain/auth-cookies';
import type { Request } from 'express';

export const CSRF_TOKEN_HEADER = 'x-csrf-token';
export type CsrfFailureCode =
  'CSRF_TOKEN_MISSING' | 'CSRF_TOKEN_INVALID' | 'CSRF_ORIGIN_INVALID';

export class CsrfError extends ApplicationError {
  constructor(code: CsrfFailureCode, message: string) {
    super(code, message, 403);
  }
}

@Injectable()
export class CsrfService {
  private readonly secret: string;
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(config: ConfigService) {
    this.secret =
      config.getOrThrow<EnvironmentVariables['CSRF_SECRET']>('CSRF_SECRET');
    this.allowedOrigins = new Set(
      config.getOrThrow<EnvironmentVariables['CSRF_ALLOWED_ORIGINS']>(
        'CSRF_ALLOWED_ORIGINS',
      ),
    );
  }

  issue(namespace: AuthCookieNamespace): string {
    const nonce = randomBytes(32).toString('base64url');
    return `${nonce}.${this.mac(namespace, nonce)}`;
  }

  validate(request: Request, namespace: AuthCookieNamespace): void {
    if (!this.isAllowedBrowserSource(request)) {
      throw new CsrfError(
        'CSRF_ORIGIN_INVALID',
        'The request origin is not allowed.',
      );
    }
    const cookie = readCookieValue(
      request.headers.cookie,
      CSRF_COOKIE_NAMES[namespace],
    );
    const header = headerValue(request.headers[CSRF_TOKEN_HEADER]);
    if (cookie === undefined || header === undefined) {
      throw new CsrfError('CSRF_TOKEN_MISSING', 'A CSRF token is required.');
    }
    if (cookie !== header || !this.isValidToken(cookie, namespace)) {
      throw new CsrfError('CSRF_TOKEN_INVALID', 'The CSRF token is invalid.');
    }
  }

  isAllowedBrowserSource(request: Request): boolean {
    const fetchSite = headerValue(request.headers['sec-fetch-site']);
    if (fetchSite === 'cross-site' || fetchSite === 'none') return false;
    const origin = headerValue(request.headers.origin);
    if (origin !== undefined)
      return this.allowedOrigins.has(origin) && isCanonicalOrigin(origin);
    const referer = headerValue(request.headers.referer);
    if (referer === undefined) return false;
    try {
      const parsed = new URL(referer);
      return (
        parsed.origin !== 'null' &&
        this.allowedOrigins.has(parsed.origin) &&
        parsed.username === '' &&
        parsed.password === ''
      );
    } catch {
      return false;
    }
  }

  private isValidToken(value: string, namespace: AuthCookieNamespace): boolean {
    const parts = value.split('.');
    if (
      parts.length !== 2 ||
      !/^[A-Za-z0-9_-]{43}$/.test(parts[0] ?? '') ||
      !/^[A-Za-z0-9_-]{43}$/.test(parts[1] ?? '')
    )
      return false;
    const expected = Buffer.from(this.mac(namespace, parts[0] ?? ''), 'utf8');
    const actual = Buffer.from(parts[1] ?? '', 'utf8');
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  private mac(namespace: AuthCookieNamespace, nonce: string): string {
    return createHmac('sha256', this.secret)
      .update(`${namespace}:${nonce}`)
      .digest('base64url');
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value) || typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function isCanonicalOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === value &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

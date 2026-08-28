import type { Server } from 'node:http';
import request from 'supertest';
import type { Test as SupertestTest } from 'supertest';
import {
  CSRF_COOKIE_NAMES,
  type AuthCookieNamespace,
} from '../../src/modules/auth/domain/auth-cookies';
import { CSRF_TOKEN_HEADER } from '../../src/modules/auth/api/csrf.service';

const ORIGINS: Record<AuthCookieNamespace, string> = {
  customer: 'http://localhost:3000',
  admin: 'http://127.0.0.1:3000',
};

export interface BrowserCsrfSession {
  readonly namespace: AuthCookieNamespace;
  readonly cookie: string;
  readonly token: string;
}

function readSetCookieHeaders(headers: unknown): string[] {
  if (Array.isArray(headers)) {
    return headers.filter(
      (value): value is string => typeof value === 'string',
    );
  }
  return typeof headers === 'string' ? [headers] : [];
}

export async function bootstrapBrowserCsrf(
  server: Server,
  namespace: AuthCookieNamespace = 'customer',
): Promise<BrowserCsrfSession> {
  const path =
    namespace === 'admin' ? '/api/v1/admin/auth/csrf' : '/api/v1/auth/csrf';
  const response = await request(server).get(path).expect(200);
  const token = (response.body as { data: { token: string } }).data.token;
  const cookieName = CSRF_COOKIE_NAMES[namespace];
  const headers = response.headers as Record<string, unknown>;
  const cookieHeader = readSetCookieHeaders(headers['set-cookie']).find(
    (value) => value.startsWith(`${cookieName}=`),
  );
  if (cookieHeader === undefined) {
    throw new Error(`CSRF bootstrap did not set ${cookieName}.`);
  }
  const cookie = cookieHeader.split(';', 1)[0];
  if (cookie === undefined || token === '') {
    throw new Error(`CSRF bootstrap returned an invalid ${cookieName}.`);
  }
  return { namespace, cookie, token };
}

export function browserRequest(
  call: SupertestTest,
  session: BrowserCsrfSession,
  authCookies: readonly string[] = [],
): SupertestTest {
  const cookies = [session.cookie, ...authCookies].join('; ');
  return call
    .set('Origin', ORIGINS[session.namespace])
    .set(CSRF_TOKEN_HEADER, session.token)
    .set('Cookie', cookies);
}

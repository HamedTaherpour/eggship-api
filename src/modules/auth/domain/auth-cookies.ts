/**
 * Browser auth cookie policy (AUTH-03 / AUTH-04 / ADM-AUTH-01).
 *
 * Customer (storefront) and Admin (back-office) cookies are namespaced so the
 * same browser can hold both sessions without overwriting. Domain is omitted
 * (host-only) unless a future Liara topology review requires otherwise.
 * Production domains are never hardcoded.
 *
 * Admin `Path` is `/api/v1/admin` so Admin cookies are not sent on storefront
 * Auth routes. Customer cookies remain `Path=/` (existing AUTH-04 contract).
 */
export const ACCESS_TOKEN_COOKIE_NAME = 'eggship_at';
export const REFRESH_TOKEN_COOKIE_NAME = 'eggship_rt';

export const ADMIN_ACCESS_TOKEN_COOKIE_NAME = 'eggship_admin_at';
export const ADMIN_REFRESH_TOKEN_COOKIE_NAME = 'eggship_admin_rt';

export const ADMIN_AUTH_COOKIE_PATH = '/api/v1/admin';
export const CSRF_COOKIE_NAMES = {
  customer: 'eggship_csrf',
  admin: 'eggship_admin_csrf',
} as const;

export type AuthCookieNamespace = 'customer' | 'admin';

export type AuthCookieSameSite = 'Lax' | 'None';

export interface AuthCookieAttributePolicy {
  httpOnly: true;
  secure: boolean;
  sameSite: AuthCookieSameSite;
  path: string;
  /**
   * Host-only cookies: Domain attribute is never set by default.
   */
  domain: undefined;
}

export interface AuthCookieNames {
  access: string;
  refresh: string;
}

export function resolveAuthCookieNames(
  namespace: AuthCookieNamespace,
): AuthCookieNames {
  if (namespace === 'admin') {
    return {
      access: ADMIN_ACCESS_TOKEN_COOKIE_NAME,
      refresh: ADMIN_REFRESH_TOKEN_COOKIE_NAME,
    };
  }
  return {
    access: ACCESS_TOKEN_COOKIE_NAME,
    refresh: REFRESH_TOKEN_COOKIE_NAME,
  };
}

export function resolveAuthCookiePath(namespace: AuthCookieNamespace): string {
  return namespace === 'admin' ? ADMIN_AUTH_COOKIE_PATH : '/';
}

export function resolveAuthCookieAttributes(
  nodeEnv: string,
  namespace: AuthCookieNamespace = 'customer',
): AuthCookieAttributePolicy {
  return {
    httpOnly: true,
    secure: nodeEnv === 'production',
    sameSite: 'Lax',
    path: resolveAuthCookiePath(namespace),
    domain: undefined,
  };
}

/**
 * True when the request path is an Admin HTTP surface (`/admin` path segment).
 * Access-token cookie extraction uses this so storefront and Admin cookies
 * never substitute for each other.
 */
export function isAdminHttpPath(path: string): boolean {
  const pathname = path.split('?')[0] ?? '';
  return pathname.split('/').includes('admin');
}

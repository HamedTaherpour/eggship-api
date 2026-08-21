import type { Request } from 'express';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import {
  readCookieValue,
  resolveAccessCookieNameForRequest,
  type AuthCookieWriter,
} from './auth-cookie.writer';

/**
 * Resolves an access token from Authorization Bearer and/or the path-appropriate
 * access cookie (`eggship_at` on storefront routes, `eggship_admin_at` on Admin
 * routes).
 *
 * Precedence: if both are present they must be identical; conflicting values
 * are rejected. Either source alone is accepted (Bearer remains useful for
 * API tooling and tests; browsers use the access cookie).
 *
 * The opposite namespace's cookie is ignored so a storefront session and an
 * Admin session in the same browser cannot confuse subject type.
 */
export function extractAccessTokenFromRequest(
  request: Request,
  cookies?: Pick<AuthCookieWriter, 'readAccessToken'>,
): string | undefined {
  const bearer = extractBearerToken(request);
  const cookieName = resolveAccessCookieNameForRequest(request);
  const cookieToken =
    cookies?.readAccessToken(request) ??
    readCookieValue(request.headers.cookie, cookieName);

  if (
    bearer !== undefined &&
    cookieToken !== undefined &&
    bearer !== cookieToken
  ) {
    throw new AuthError(
      AuthErrorCode.INVALID_TOKEN,
      'Conflicting access-token credentials.',
    );
  }

  return bearer ?? cookieToken;
}

export function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string') {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/iu.exec(header.trim());
  if (match === null) {
    return undefined;
  }
  const token = match[1]?.trim();
  return token === undefined || token === '' ? undefined : token;
}

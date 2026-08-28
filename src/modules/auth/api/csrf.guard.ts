import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { extractBearerToken } from './access-token.extraction';
import { readCookieValue } from './auth-cookie.writer';
import { CsrfService } from './csrf.service';
import {
  isAdminHttpPath,
  resolveAuthCookieNames,
  type AuthCookieNamespace,
} from '../domain/auth-cookies';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly csrf: CsrfService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return true;
    const namespace: AuthCookieNamespace = isAdminHttpPath(
      request.path || request.url || '',
    )
      ? 'admin'
      : 'customer';
    const authNames = resolveAuthCookieNames(namespace);
    const authCookie =
      readCookieValue(request.headers.cookie, authNames.access) ??
      readCookieValue(request.headers.cookie, authNames.refresh);
    // A Bearer-only request is authoritative non-browser transport. Presence of
    // the namespace's auth cookie keeps it on the browser-CSRF path.
    if (authCookie === undefined && extractBearerToken(request) !== undefined)
      return true;
    this.csrf.validate(request, namespace);
    return true;
  }
}

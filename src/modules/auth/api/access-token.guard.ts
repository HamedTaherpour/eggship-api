import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import type { AuthenticatedPrincipal } from '../domain/authenticated-principal';
import { AccessTokenService } from '../infrastructure/access-token.service';
import { extractAccessTokenFromRequest } from './access-token.extraction';

export const AUTHENTICATED_PRINCIPAL_REQUEST_KEY =
  'eggshipAuthenticatedPrincipal';

/**
 * Verifies an access token from the path-appropriate access cookie
 * (`eggship_at` on storefront routes, `eggship_admin_at` on `/admin` routes)
 * and/or Authorization Bearer. Conflicting cookie + Bearer values are rejected.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly accessTokens: AccessTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    let token: string | undefined;
    try {
      token = extractAccessTokenFromRequest(request);
    } catch (error: unknown) {
      if (error instanceof AuthError) {
        throw unauthorized(error.code, error.message);
      }
      throw unauthorized(
        AuthErrorCode.INVALID_TOKEN,
        'Access token is invalid.',
      );
    }

    if (token === undefined) {
      throw unauthorized(
        AuthErrorCode.UNAUTHENTICATED,
        'Authentication required.',
      );
    }

    try {
      const claims = await this.accessTokens.verifyAccessToken(token);
      const principal: AuthenticatedPrincipal = {
        subjectId: claims.subjectId,
        subjectType: claims.subjectType,
        sessionId: claims.sessionId,
      };
      (
        request as Request & {
          [AUTHENTICATED_PRINCIPAL_REQUEST_KEY]?: AuthenticatedPrincipal;
        }
      )[AUTHENTICATED_PRINCIPAL_REQUEST_KEY] = principal;
      return true;
    } catch (error: unknown) {
      if (error instanceof AuthError) {
        throw unauthorized(error.code, error.message);
      }
      throw unauthorized(
        AuthErrorCode.INVALID_TOKEN,
        'Access token is invalid.',
      );
    }
  }
}

function unauthorized(
  code: AuthErrorCode,
  message: string,
): UnauthorizedException {
  return new UnauthorizedException({
    code,
    message,
  });
}

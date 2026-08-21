import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { getAuthenticatedPrincipal } from '../../modules/auth/api/authenticated-principal.util';
import { ApplicationLogger } from '../observability/application-logger.service';
import {
  AuthorizationDenialReason,
  AuthorizationService,
  authorizationError,
} from './authorization.service';
import { readRequiredPermissions } from './require-permissions.decorator';

/**
 * Enforces `@RequirePermissions` declarations for admin routes.
 *
 * The guard requires an already-authenticated principal — it does not verify
 * tokens. Place it after the authenticating guard
 * (`@UseGuards(AccessTokenGuard, PermissionGuard)`); if authentication is
 * missing the request is refused rather than treated as anonymous-allowed.
 *
 * Responses carry only `AUTH_UNAUTHENTICATED` (401) or `AUTH_FORBIDDEN` (403).
 * The precise policy reason goes to the `authz.denied` operational log.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
    private readonly logger: ApplicationLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = readRequiredPermissions(this.reflector, context);
    const request = context.switchToHttp().getRequest<Request>();
    const principal = getAuthenticatedPrincipal(request);
    const decision = await this.authorization.authorizeReflected(
      principal,
      required,
    );

    if (decision.granted) {
      return true;
    }

    const isMisconfiguration =
      decision.reason === AuthorizationDenialReason.NO_PERMISSIONS_REQUESTED ||
      decision.reason ===
        AuthorizationDenialReason.UNKNOWN_PERMISSION_REQUESTED;
    const fields = {
      module: 'authz',
      operation: 'authz.denied',
      reason: decision.reason,
      subjectType: principal?.subjectType ?? 'ANONYMOUS',
      subjectId: principal?.subjectId,
      requiredPermissions: required.filter(
        (value): value is string => typeof value === 'string',
      ),
    };

    if (isMisconfiguration) {
      // A guarded route without a valid permission declaration is a wiring
      // defect; it is denied, and it must be loud rather than silently 403.
      this.logger.error(
        fields,
        'Authorization denied by misconfigured permission declaration',
      );
    } else {
      this.logger.warn(fields, 'Authorization denied');
    }

    // The denial-to-response mapping lives with the policy, in
    // `authorizationError`; `ApiExceptionFilter` turns the AuthError into the
    // 401/403 envelope so there is one copy of this decision.
    throw authorizationError(decision.reason);
  }
}

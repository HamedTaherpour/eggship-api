import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../../modules/auth/domain/auth-error';
import { AuthErrorCode } from '../../modules/auth/domain/auth-error-codes';
import type { AuthenticatedPrincipal } from '../../modules/auth/domain/authenticated-principal';
import { AuthSubjectType } from '../../modules/auth/domain/subject-type';
import { ApplicationLogger } from '../observability/application-logger.service';
import { isAdminRole } from './admin-role';
import type {
  AdminAuthorizationLookup,
  AdminAuthorizationRecord,
  AdminRoleResolver,
} from './admin-role-resolver';
import { ADMIN_ROLE_RESOLVER } from './authorization.tokens';
import { isPermission } from './permission';
import type { Permission } from './permission';
import { permissionsForRole } from './role-permissions';

/**
 * Why authorization was refused. These identifiers are safe for operational
 * logs and must never reach an HTTP response body.
 */
export const AuthorizationDenialReason = {
  UNAUTHENTICATED: 'unauthenticated',
  SUBJECT_NOT_ADMIN: 'subject_not_admin',
  ADMIN_DIRECTORY_UNAVAILABLE: 'admin_directory_unavailable',
  ADMIN_NOT_FOUND: 'admin_not_found',
  ADMIN_INACTIVE: 'admin_inactive',
  ADMIN_IDENTITY_MISMATCH: 'admin_identity_mismatch',
  UNKNOWN_ROLE: 'unknown_role',
  UNKNOWN_PERMISSION_REQUESTED: 'unknown_permission_requested',
  NO_PERMISSIONS_REQUESTED: 'no_permissions_requested',
  MISSING_PERMISSION: 'missing_permission',
} as const;

export type AuthorizationDenialReason =
  (typeof AuthorizationDenialReason)[keyof typeof AuthorizationDenialReason];

/**
 * The granted variant deliberately carries permissions but not the role name:
 * callers authorize on permissions, never by branching on a role (ADR 0007).
 */
export type AuthorizationDecision =
  | { readonly granted: true; readonly permissions: ReadonlySet<Permission> }
  | { readonly granted: false; readonly reason: AuthorizationDenialReason };

/**
 * Resolves admin permissions and evaluates permission requirements.
 *
 * Fail-closed contract: an absent principal, a non-admin subject, missing or
 * inactive admin state, an unrecognized role, an unrecognized requested
 * permission, and an empty requirement list all deny. There is no role-based
 * bypass — `SUPER_ADMIN` is granted through explicit policy like any other role.
 */
@Injectable()
export class AuthorizationService {
  constructor(
    @Inject(ADMIN_ROLE_RESOLVER)
    private readonly adminRoles: AdminRoleResolver,
    private readonly logger: ApplicationLogger,
  ) {}

  /**
   * Evaluates whether the principal holds **all** requested permissions.
   * Returns a decision rather than throwing so the caller can log the safe
   * denial reason before emitting a client-facing error.
   *
   * The signature requires catalogued `Permission` values, so a bare string or
   * a typo is a compile error rather than a silent runtime denial.
   */
  authorize(
    principal: AuthenticatedPrincipal | undefined,
    requiredPermissions: readonly [Permission, ...Permission[]],
  ): Promise<AuthorizationDecision> {
    return this.evaluate(principal, requiredPermissions);
  }

  /**
   * Evaluates a requirement read from route metadata, which is untyped by
   * nature. Only `PermissionGuard` should need this: an unrecognized or empty
   * requirement is treated as a wiring defect and denies.
   */
  authorizeReflected(
    principal: AuthenticatedPrincipal | undefined,
    requiredPermissions: readonly unknown[],
  ): Promise<AuthorizationDecision> {
    return this.evaluate(principal, requiredPermissions);
  }

  private async evaluate(
    principal: AuthenticatedPrincipal | undefined,
    requiredPermissions: readonly unknown[],
  ): Promise<AuthorizationDecision> {
    // Authentication is checked before the requirement list so that a
    // misconfigured route cannot be fingerprinted by an anonymous caller: it
    // answers 401 exactly like a correctly configured one.
    if (principal === undefined) {
      return deny(AuthorizationDenialReason.UNAUTHENTICATED);
    }

    if (requiredPermissions.length === 0) {
      return deny(AuthorizationDenialReason.NO_PERMISSIONS_REQUESTED);
    }

    const required: Permission[] = [];
    for (const candidate of requiredPermissions) {
      if (!isPermission(candidate)) {
        return deny(AuthorizationDenialReason.UNKNOWN_PERMISSION_REQUESTED);
      }
      required.push(candidate);
    }

    const resolved = await this.resolveAdminPermissions(principal);
    if (!resolved.granted) {
      return resolved;
    }

    const holdsAll = required.every((permission) =>
      resolved.permissions.has(permission),
    );
    return holdsAll
      ? resolved
      : deny(AuthorizationDenialReason.MISSING_PERMISSION);
  }

  /**
   * Effective admin permissions for the principal. A customer (`USER`) subject
   * always resolves to an empty set — customer routes authorize through
   * authentication plus ownership, never through admin RBAC.
   */
  async getPermissions(
    principal: AuthenticatedPrincipal | undefined,
  ): Promise<ReadonlySet<Permission>> {
    const resolved = await this.resolveAdminPermissions(principal);
    return resolved.granted ? resolved.permissions : new Set<Permission>();
  }

  /**
   * Single-permission convenience. Check several permissions with one
   * `authorize`/`requirePermissions` call rather than repeated calls here, so
   * admin state is resolved once.
   */
  async hasPermission(
    principal: AuthenticatedPrincipal | undefined,
    permission: Permission,
  ): Promise<boolean> {
    const decision = await this.authorize(principal, [permission]);
    return decision.granted;
  }

  /**
   * Throws a stable, detail-free authorization error when the principal does not
   * hold every requested permission. For use by application services that
   * authorize outside the HTTP guard path.
   */
  async requirePermissions(
    principal: AuthenticatedPrincipal | undefined,
    requiredPermissions: readonly [Permission, ...Permission[]],
  ): Promise<void> {
    const decision = await this.authorize(principal, requiredPermissions);
    if (!decision.granted) {
      throw authorizationError(decision.reason);
    }
  }

  private async resolveAdminPermissions(
    principal: AuthenticatedPrincipal | undefined,
  ): Promise<AuthorizationDecision> {
    if (principal === undefined) {
      return deny(AuthorizationDenialReason.UNAUTHENTICATED);
    }
    if (principal.subjectType !== AuthSubjectType.ADMIN) {
      return deny(AuthorizationDenialReason.SUBJECT_NOT_ADMIN);
    }

    const lookup = await this.lookupAdmin(principal.subjectId);
    if (lookup.status === 'unavailable') {
      return deny(AuthorizationDenialReason.ADMIN_DIRECTORY_UNAVAILABLE);
    }
    if (lookup.status === 'not_found') {
      return deny(AuthorizationDenialReason.ADMIN_NOT_FOUND);
    }
    // The record crosses a persistence boundary, so its shape is checked rather
    // than trusted: a malformed answer must deny like any other unusable one,
    // not throw out of the guard as a 500.
    const record: unknown = lookup.record;
    if (!isAdminAuthorizationRecord(record)) {
      return deny(AuthorizationDenialReason.ADMIN_DIRECTORY_UNAVAILABLE);
    }
    if (record.adminId !== principal.subjectId) {
      // Defense in depth: a resolver bug or mis-scoped cache must not authorize
      // one admin with another admin's role.
      return deny(AuthorizationDenialReason.ADMIN_IDENTITY_MISMATCH);
    }
    if (!record.isActive) {
      return deny(AuthorizationDenialReason.ADMIN_INACTIVE);
    }
    if (!isAdminRole(record.role)) {
      return deny(AuthorizationDenialReason.UNKNOWN_ROLE);
    }

    return {
      granted: true,
      permissions: permissionsForRole(record.role),
    };
  }

  /**
   * A failing admin directory is an availability incident, not an authorization
   * answer: it degrades to `unavailable` so the request is denied through the
   * documented path with telemetry instead of surfacing as a 500.
   */
  private async lookupAdmin(
    adminId: string,
  ): Promise<AdminAuthorizationLookup> {
    try {
      return await this.adminRoles.findAdminAuthorization(adminId);
    } catch (error) {
      this.logger.error(
        {
          module: 'authz',
          operation: 'authz.admin_lookup_failed',
          subjectType: AuthSubjectType.ADMIN,
          subjectId: adminId,
        },
        'Admin authorization lookup failed',
        error instanceof Error ? error : undefined,
      );
      return { status: 'unavailable' };
    }
  }
}

/**
 * Maps a denial reason to a client-facing error. Only the authentication/
 * authorization distinction is exposed; the reason itself stays in logs.
 */
export function authorizationError(
  reason: AuthorizationDenialReason,
): AuthError {
  return reason === AuthorizationDenialReason.UNAUTHENTICATED
    ? new AuthError(AuthErrorCode.UNAUTHENTICATED, 'Authentication required.')
    : new AuthError(AuthErrorCode.FORBIDDEN, 'Insufficient permissions.');
}

function deny(reason: AuthorizationDenialReason): AuthorizationDecision {
  return { granted: false, reason };
}

function isAdminAuthorizationRecord(
  value: unknown,
): value is AdminAuthorizationRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<
    Record<keyof AdminAuthorizationRecord, unknown>
  >;
  return (
    typeof candidate.adminId === 'string' &&
    typeof candidate.role === 'string' &&
    typeof candidate.isActive === 'boolean'
  );
}

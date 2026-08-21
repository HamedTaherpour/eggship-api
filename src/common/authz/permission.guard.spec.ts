import { SetMetadata } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTHENTICATED_PRINCIPAL_REQUEST_KEY } from '../../modules/auth/api/access-token.guard';
import { AuthError } from '../../modules/auth/domain/auth-error';
import { AuthErrorCode } from '../../modules/auth/domain/auth-error-codes';
import type { AuthenticatedPrincipal } from '../../modules/auth/domain/authenticated-principal';
import { AuthSubjectType } from '../../modules/auth/domain/subject-type';
import type {
  ApplicationLogger,
  LogFields,
} from '../observability/application-logger.service';
import { AdminRole } from './admin-role';
import type {
  AdminAuthorizationLookup,
  AdminRoleResolver,
} from './admin-role-resolver';
import { AuthorizationService } from './authorization.service';
import { Permission } from './permission';
import { PermissionGuard } from './permission.guard';
import {
  REQUIRED_PERMISSIONS_METADATA_KEY,
  RequirePermissions,
} from './require-permissions.decorator';

// `this: void` keeps the handler references below detached-method safe, which is
// how Nest passes them to guards.
@RequirePermissions(Permission.INVENTORY_READ)
class ProbeController {
  @RequirePermissions(Permission.INVENTORY_ADJUST)
  adjust(this: void): void {}

  @RequirePermissions(Permission.ADMIN_MANAGE)
  manageAdmins(this: void): void {}

  unguarded(this: void): void {}

  // A stale or hand-written identifier outside the catalog. Written as raw
  // metadata because that is how such a value actually arrives — through
  // untyped reflection, not through the typed decorator.
  @SetMetadata(REQUIRED_PERMISSIONS_METADATA_KEY, ['INVENTORY_DESTROY'])
  unknownPermission(this: void): void {}
}

interface CapturedLog {
  readonly level: 'warn' | 'error';
  readonly fields: LogFields;
}

class RecordingLogger {
  readonly entries: CapturedLog[] = [];

  warn(fields: LogFields): void {
    this.entries.push({ level: 'warn', fields });
  }

  error(fields: LogFields): void {
    this.entries.push({ level: 'error', fields });
  }
}

class StubAdminRoleResolver implements AdminRoleResolver {
  constructor(private readonly lookup: AdminAuthorizationLookup) {}

  findAdminAuthorization(adminId: string): Promise<AdminAuthorizationLookup> {
    void adminId;
    return Promise.resolve(this.lookup);
  }
}

type ProbeHandler = (...args: never[]) => unknown;
type ProbeTarget = ProbeHandler | (new () => unknown);

/** Minimal HTTP ExecutionContext; only the members the guard reads are real. */
function contextFor(
  handler: ProbeHandler,
  principal?: AuthenticatedPrincipal,
  controller: ProbeTarget = ProbeController,
): ExecutionContext {
  const request: Record<string, unknown> = {};
  if (principal !== undefined) {
    request[AUTHENTICATED_PRINCIPAL_REQUEST_KEY] = principal;
  }
  const http = {
    getRequest: (): Record<string, unknown> => request,
  };
  return {
    getHandler: (): ProbeHandler => handler,
    getClass: (): ProbeTarget => controller,
    switchToHttp: (): typeof http => http,
  } as unknown as ExecutionContext;
}

function guardFor(lookup: AdminAuthorizationLookup): {
  guard: PermissionGuard;
  logger: RecordingLogger;
} {
  const logger = new RecordingLogger();
  const guard = new PermissionGuard(
    new Reflector(),
    new AuthorizationService(
      new StubAdminRoleResolver(lookup),
      logger as unknown as ApplicationLogger,
    ),
    logger as unknown as ApplicationLogger,
  );
  return { guard, logger };
}

const adminPrincipal: AuthenticatedPrincipal = {
  subjectId: 'admin-1',
  subjectType: AuthSubjectType.ADMIN,
  sessionId: 'session-admin',
};

const customerPrincipal: AuthenticatedPrincipal = {
  subjectId: 'user-1',
  subjectType: AuthSubjectType.USER,
  sessionId: 'session-user',
};

function foundAdmin(role: string, isActive = true): AdminAuthorizationLookup {
  return { status: 'found', record: { adminId: 'admin-1', role, isActive } };
}

describe('RequirePermissions', () => {
  it('records declared permissions as reflectable metadata', () => {
    const reflector = new Reflector();

    expect(
      reflector.get<unknown>(
        REQUIRED_PERMISSIONS_METADATA_KEY,
        ProbeController.prototype.adjust,
      ),
    ).toEqual([Permission.INVENTORY_ADJUST]);
    expect(
      reflector.get<unknown>(
        REQUIRED_PERMISSIONS_METADATA_KEY,
        ProbeController,
      ),
    ).toEqual([Permission.INVENTORY_READ]);
  });

  it('unions controller-level and handler-level requirements', () => {
    const reflector = new Reflector();

    expect(
      reflector.getAllAndMerge<unknown[]>(REQUIRED_PERMISSIONS_METADATA_KEY, [
        ProbeController.prototype.adjust,
        ProbeController,
      ]),
    ).toEqual([Permission.INVENTORY_ADJUST, Permission.INVENTORY_READ]);
  });
});

describe('PermissionGuard', () => {
  it('allows an active admin holding every required permission', async () => {
    const { guard, logger } = guardFor(foundAdmin(AdminRole.WAREHOUSE));

    await expect(
      guard.canActivate(
        contextFor(ProbeController.prototype.adjust, adminPrincipal),
      ),
    ).resolves.toBe(true);
    expect(logger.entries).toEqual([]);
  });

  it('denies an admin missing one of the merged requirements', async () => {
    const { guard } = guardFor(foundAdmin(AdminRole.WAREHOUSE));

    await expect(
      guard.canActivate(
        contextFor(ProbeController.prototype.manageAdmins, adminPrincipal),
      ),
    ).rejects.toMatchObject({ code: AuthErrorCode.FORBIDDEN });
  });

  it('denies a customer subject on an admin route with 403 and no policy detail', async () => {
    const { guard, logger } = guardFor(foundAdmin(AdminRole.SUPER_ADMIN));

    const rejection: unknown = await guard
      .canActivate(
        contextFor(ProbeController.prototype.adjust, customerPrincipal),
      )
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(AuthError);
    expect(rejection).toMatchObject({
      code: AuthErrorCode.FORBIDDEN,
      message: 'Insufficient permissions.',
      details: {},
    });
    expect(logger.entries[0]?.fields['reason']).toBe('subject_not_admin');
    expect(logger.entries[0]?.fields['subjectType']).toBe(AuthSubjectType.USER);
  });

  it('denies an unauthenticated request as unauthenticated, not forbidden', async () => {
    const { guard, logger } = guardFor(foundAdmin(AdminRole.SUPER_ADMIN));

    const rejection: unknown = await guard
      .canActivate(contextFor(ProbeController.prototype.adjust))
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(AuthError);
    expect(rejection).toMatchObject({
      code: AuthErrorCode.UNAUTHENTICATED,
      message: 'Authentication required.',
    });
    expect(logger.entries[0]?.fields['subjectType']).toBe('ANONYMOUS');
    expect(logger.entries[0]?.fields['subjectId']).toBeUndefined();
  });

  it('denies an inactive admin', async () => {
    const { guard, logger } = guardFor(
      foundAdmin(AdminRole.SUPER_ADMIN, false),
    );

    await expect(
      guard.canActivate(
        contextFor(ProbeController.prototype.adjust, adminPrincipal),
      ),
    ).rejects.toMatchObject({ code: AuthErrorCode.FORBIDDEN });
    expect(logger.entries[0]?.fields['reason']).toBe('admin_inactive');
  });

  it('enforces a controller-level declaration on a handler that declares none', async () => {
    const { guard, logger } = guardFor(foundAdmin(AdminRole.WAREHOUSE));

    // ProbeController declares INVENTORY_READ at class level; `unguarded`
    // declares nothing, so the class requirement is what must be enforced.
    await expect(
      guard.canActivate(
        contextFor(ProbeController.prototype.unguarded, adminPrincipal),
      ),
    ).resolves.toBe(true);
    expect(logger.entries).toEqual([]);

    // On a denial, the requirement logged is the class declaration alone,
    // proving it was the enforced requirement rather than an empty set.
    const inactive = guardFor(foundAdmin(AdminRole.WAREHOUSE, false));
    await expect(
      inactive.guard.canActivate(
        contextFor(ProbeController.prototype.unguarded, adminPrincipal),
      ),
    ).rejects.toMatchObject({ code: AuthErrorCode.FORBIDDEN });
    expect(inactive.logger.entries[0]?.fields['requiredPermissions']).toEqual([
      Permission.INVENTORY_READ,
    ]);
  });

  it('denies a guarded route that declares no permissions and logs it as a defect', async () => {
    const { guard, logger } = guardFor(foundAdmin(AdminRole.SUPER_ADMIN));
    const context = contextFor(
      ProbeController.prototype.unguarded,
      adminPrincipal,
      RecordingLogger,
    );

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: AuthErrorCode.FORBIDDEN,
    });
    expect(logger.entries[0]?.level).toBe('error');
    expect(logger.entries[0]?.fields['reason']).toBe(
      'no_permissions_requested',
    );
  });

  it('denies a route declaring a permission outside the catalog and logs it as a defect', async () => {
    const { guard, logger } = guardFor(foundAdmin(AdminRole.SUPER_ADMIN));

    const rejection: unknown = await guard
      .canActivate(
        contextFor(ProbeController.prototype.unknownPermission, adminPrincipal),
      )
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(AuthError);
    expect(logger.entries[0]?.level).toBe('error');
    expect(logger.entries[0]?.fields['reason']).toBe(
      'unknown_permission_requested',
    );
    expect(JSON.stringify(rejection)).not.toMatch(/INVENTORY_DESTROY/u);
  });

  it('logs the required permissions but never returns them to the client', async () => {
    const { guard, logger } = guardFor(foundAdmin(AdminRole.ORDER_OPS));

    const rejection: unknown = await guard
      .canActivate(contextFor(ProbeController.prototype.adjust, adminPrincipal))
      .catch((error: unknown) => error);

    expect(logger.entries[0]?.fields['requiredPermissions']).toEqual([
      Permission.INVENTORY_ADJUST,
      Permission.INVENTORY_READ,
    ]);
    expect(JSON.stringify(rejection)).not.toMatch(/INVENTORY/u);
  });
});

import { AuthError } from '../../modules/auth/domain/auth-error';
import { AuthErrorCode } from '../../modules/auth/domain/auth-error-codes';
import type { AuthenticatedPrincipal } from '../../modules/auth/domain/authenticated-principal';
import { AuthSubjectType } from '../../modules/auth/domain/subject-type';
import type {
  ApplicationLogger,
  LogFields,
} from '../observability/application-logger.service';
import { AdminPersistenceUnavailableRoleResolver } from './admin-persistence-unavailable.resolver';
import { AdminRole } from './admin-role';
import type {
  AdminAuthorizationLookup,
  AdminRoleResolver,
} from './admin-role-resolver';
import {
  AuthorizationDenialReason,
  AuthorizationService,
} from './authorization.service';
import { Permission } from './permission';

class StubAdminRoleResolver implements AdminRoleResolver {
  readonly requestedIds: string[] = [];
  private failure: Error | undefined;

  constructor(private lookup: AdminAuthorizationLookup) {}

  findAdminAuthorization(adminId: string): Promise<AdminAuthorizationLookup> {
    this.requestedIds.push(adminId);
    return this.failure === undefined
      ? Promise.resolve(this.lookup)
      : Promise.reject(this.failure);
  }

  setLookup(lookup: AdminAuthorizationLookup): void {
    this.lookup = lookup;
  }

  failWith(error: Error): void {
    this.failure = error;
  }
}

interface CapturedLog {
  readonly level: 'warn' | 'error';
  readonly fields: LogFields;
  readonly error?: Error;
}

class RecordingLogger {
  readonly entries: CapturedLog[] = [];

  warn(fields: LogFields): void {
    this.entries.push({ level: 'warn', fields });
  }

  error(fields: LogFields, message: string, error?: Error): void {
    void message;
    this.entries.push({ level: 'error', fields, error });
  }
}

function admin(adminId = 'admin-1'): AuthenticatedPrincipal {
  return {
    subjectId: adminId,
    subjectType: AuthSubjectType.ADMIN,
    sessionId: 'session-admin',
  };
}

function customer(): AuthenticatedPrincipal {
  return {
    subjectId: 'user-1',
    subjectType: AuthSubjectType.USER,
    sessionId: 'session-user',
  };
}

function activeAdmin(
  role: string,
  adminId = 'admin-1',
): AdminAuthorizationLookup {
  return { status: 'found', record: { adminId, role, isActive: true } };
}

function serviceFor(lookup: AdminAuthorizationLookup): {
  service: AuthorizationService;
  resolver: StubAdminRoleResolver;
  logger: RecordingLogger;
} {
  const resolver = new StubAdminRoleResolver(lookup);
  const logger = new RecordingLogger();
  return {
    service: new AuthorizationService(
      resolver,
      logger as unknown as ApplicationLogger,
    ),
    resolver,
    logger,
  };
}

describe('AuthorizationService', () => {
  describe('admin permission resolution', () => {
    it('grants when the role policy contains the required permission', async () => {
      const { service, resolver } = serviceFor(
        activeAdmin(AdminRole.WAREHOUSE),
      );

      const decision = await service.authorize(admin(), [
        Permission.INVENTORY_ADJUST,
      ]);

      expect(decision.granted).toBe(true);
      if (decision.granted) {
        expect(decision.permissions.has(Permission.INVENTORY_READ)).toBe(true);
        // The decision exposes permissions only; callers must not branch on role.
        expect(Object.keys(decision)).toEqual(['granted', 'permissions']);
      }
      expect(resolver.requestedIds).toEqual(['admin-1']);
    });

    it('resolves the admin from the principal subject id only', async () => {
      const { service, resolver } = serviceFor(
        activeAdmin(AdminRole.SUPER_ADMIN, 'admin-42'),
      );

      await service.authorize(admin('admin-42'), [Permission.ADMIN_MANAGE]);

      expect(resolver.requestedIds).toEqual(['admin-42']);
    });

    it('denies a permission the role policy does not grant', async () => {
      const { service } = serviceFor(activeAdmin(AdminRole.ORDER_OPS));

      const decision = await service.authorize(admin(), [
        Permission.INVENTORY_ADJUST,
      ]);

      expect(decision).toEqual({
        granted: false,
        reason: AuthorizationDenialReason.MISSING_PERMISSION,
      });
    });

    it('grants SUPER_ADMIN through explicit policy rather than a role bypass', async () => {
      const { service } = serviceFor(activeAdmin(AdminRole.SUPER_ADMIN));

      await expect(
        service.hasPermission(admin(), Permission.ADMIN_MANAGE),
      ).resolves.toBe(true);
      await expect(
        service.hasPermission(admin(), Permission.INVENTORY_ADJUST),
      ).resolves.toBe(true);
    });

    it('denies every permission for SUPER_ADMIN once the admin is inactive', async () => {
      const { service } = serviceFor({
        status: 'found',
        record: {
          adminId: 'admin-1',
          role: AdminRole.SUPER_ADMIN,
          isActive: false,
        },
      });

      const decision = await service.authorize(admin(), [
        Permission.ANALYTICS_READ,
      ]);

      expect(decision).toEqual({
        granted: false,
        reason: AuthorizationDenialReason.ADMIN_INACTIVE,
      });
    });

    it('denies an unrecognized persisted role instead of defaulting', async () => {
      const { service } = serviceFor(activeAdmin('ROOT'));

      const decision = await service.authorize(admin(), [
        Permission.CATALOG_READ,
      ]);

      expect(decision).toEqual({
        granted: false,
        reason: AuthorizationDenialReason.UNKNOWN_ROLE,
      });
    });

    it('denies when the admin record is missing', async () => {
      const { service } = serviceFor({ status: 'not_found' });

      const decision = await service.authorize(admin(), [
        Permission.CATALOG_READ,
      ]);

      expect(decision).toEqual({
        granted: false,
        reason: AuthorizationDenialReason.ADMIN_NOT_FOUND,
      });
    });

    it('denies when the directory answers about a different admin', async () => {
      const { service } = serviceFor(
        activeAdmin(AdminRole.SUPER_ADMIN, 'another-admin'),
      );

      const decision = await service.authorize(admin('admin-1'), [
        Permission.CATALOG_READ,
      ]);

      expect(decision).toEqual({
        granted: false,
        reason: AuthorizationDenialReason.ADMIN_IDENTITY_MISMATCH,
      });
    });

    it('degrades a malformed directory answer to a denial rather than an error', async () => {
      // A resolver that reports success without a usable record must not throw
      // out of the guard as a 500.
      const malformed = {
        status: 'found',
      } as unknown as AdminAuthorizationLookup;
      const { service } = serviceFor(malformed);

      await expect(
        service.authorize(admin(), [Permission.CATALOG_READ]),
      ).resolves.toEqual({
        granted: false,
        reason: AuthorizationDenialReason.ADMIN_DIRECTORY_UNAVAILABLE,
      });
    });

    it('degrades a throwing directory to a denial rather than an error', async () => {
      const { service, resolver, logger } = serviceFor(
        activeAdmin(AdminRole.SUPER_ADMIN),
      );
      const failure = new Error('connection terminated unexpectedly');
      resolver.failWith(failure);

      await expect(
        service.authorize(admin(), [Permission.CATALOG_READ]),
      ).resolves.toEqual({
        granted: false,
        reason: AuthorizationDenialReason.ADMIN_DIRECTORY_UNAVAILABLE,
      });
      expect(logger.entries[0]).toMatchObject({
        level: 'error',
        error: failure,
      });
      expect(logger.entries[0]?.fields['operation']).toBe(
        'authz.admin_lookup_failed',
      );
    });

    it('denies when admin identity persistence is unavailable', async () => {
      const service = new AuthorizationService(
        new AdminPersistenceUnavailableRoleResolver(),
        new RecordingLogger() as unknown as ApplicationLogger,
      );

      const decision = await service.authorize(admin(), [
        Permission.CATALOG_READ,
      ]);

      expect(decision).toEqual({
        granted: false,
        reason: AuthorizationDenialReason.ADMIN_DIRECTORY_UNAVAILABLE,
      });
      await expect(service.getPermissions(admin())).resolves.toEqual(new Set());
    });
  });

  describe('multi-permission semantics', () => {
    it('requires all listed permissions', async () => {
      const { service } = serviceFor(activeAdmin(AdminRole.WAREHOUSE));

      await expect(
        service.authorize(admin(), [
          Permission.INVENTORY_READ,
          Permission.INVENTORY_ADJUST,
        ]),
      ).resolves.toMatchObject({ granted: true });

      await expect(
        service.authorize(admin(), [
          Permission.INVENTORY_READ,
          Permission.CATALOG_MANAGE,
        ]),
      ).resolves.toEqual({
        granted: false,
        reason: AuthorizationDenialReason.MISSING_PERMISSION,
      });
    });
  });

  // Route metadata is untyped, so these defects can only arrive through
  // `authorizeReflected`; the typed `authorize` rejects them at compile time.
  describe('fail-closed defaults', () => {
    it('denies an empty requirement list', async () => {
      const { service } = serviceFor(activeAdmin(AdminRole.SUPER_ADMIN));

      await expect(service.authorizeReflected(admin(), [])).resolves.toEqual({
        granted: false,
        reason: AuthorizationDenialReason.NO_PERMISSIONS_REQUESTED,
      });
    });

    it('denies an unrecognized requested permission', async () => {
      const { service } = serviceFor(activeAdmin(AdminRole.SUPER_ADMIN));

      await expect(
        service.authorizeReflected(admin(), ['INVENTORY_DELETE_EVERYTHING']),
      ).resolves.toEqual({
        granted: false,
        reason: AuthorizationDenialReason.UNKNOWN_PERMISSION_REQUESTED,
      });
      await expect(
        service.authorizeReflected(admin(), [
          Permission.CATALOG_READ,
          undefined,
        ]),
      ).resolves.toEqual({
        granted: false,
        reason: AuthorizationDenialReason.UNKNOWN_PERMISSION_REQUESTED,
      });
    });

    it('does not consult admin state before validating the requirement', async () => {
      const { service, resolver } = serviceFor(
        activeAdmin(AdminRole.SUPER_ADMIN),
      );

      await service.authorizeReflected(admin(), ['NOT_A_PERMISSION']);

      expect(resolver.requestedIds).toEqual([]);
    });

    it('denies a missing principal as unauthenticated', async () => {
      const { service } = serviceFor(activeAdmin(AdminRole.SUPER_ADMIN));

      await expect(
        service.authorize(undefined, [Permission.CATALOG_READ]),
      ).resolves.toEqual({
        granted: false,
        reason: AuthorizationDenialReason.UNAUTHENTICATED,
      });
    });

    it('reports a misconfigured route as unauthenticated to an anonymous caller', async () => {
      const { service } = serviceFor(activeAdmin(AdminRole.SUPER_ADMIN));

      // A wiring defect must not be distinguishable from a correct route
      // without credentials, and must not let anonymous traffic drive
      // error-level logs.
      for (const required of [[], ['NOT_A_PERMISSION']]) {
        await expect(
          service.authorizeReflected(undefined, required),
        ).resolves.toEqual({
          granted: false,
          reason: AuthorizationDenialReason.UNAUTHENTICATED,
        });
      }
    });
  });

  describe('customer / admin separation', () => {
    it('never resolves admin permissions for a USER subject', async () => {
      const { service, resolver } = serviceFor(
        activeAdmin(AdminRole.SUPER_ADMIN),
      );

      const decision = await service.authorize(customer(), [
        Permission.ORDER_READ,
      ]);

      expect(decision).toEqual({
        granted: false,
        reason: AuthorizationDenialReason.SUBJECT_NOT_ADMIN,
      });
      await expect(service.getPermissions(customer())).resolves.toEqual(
        new Set(),
      );
      expect(resolver.requestedIds).toEqual([]);
    });

    it('does not treat a USER subject as an admin with an empty role', async () => {
      const { service } = serviceFor(activeAdmin(AdminRole.WAREHOUSE));

      await expect(
        service.hasPermission(customer(), Permission.INVENTORY_READ),
      ).resolves.toBe(false);
    });
  });

  describe('requirePermissions', () => {
    it('resolves silently when the admin holds the permissions', async () => {
      const { service } = serviceFor(activeAdmin(AdminRole.ORDER_OPS));

      await expect(
        service.requirePermissions(admin(), [Permission.ORDER_TRANSITION]),
      ).resolves.toBeUndefined();
    });

    it('throws AUTH_FORBIDDEN without leaking the failed policy', async () => {
      const { service } = serviceFor(activeAdmin(AdminRole.ORDER_OPS));

      await expect(
        service.requirePermissions(admin(), [Permission.INVENTORY_ADJUST]),
      ).rejects.toMatchObject({
        code: AuthErrorCode.FORBIDDEN,
        message: 'Insufficient permissions.',
        details: {},
      });

      const error = await service
        .requirePermissions(admin(), [Permission.INVENTORY_ADJUST])
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AuthError);
      expect(JSON.stringify(error)).not.toMatch(/INVENTORY_ADJUST/u);
      expect(JSON.stringify(error)).not.toMatch(/ORDER_OPS/u);
    });

    it('throws AUTH_UNAUTHENTICATED when no principal is present', async () => {
      const { service } = serviceFor(activeAdmin(AdminRole.SUPER_ADMIN));

      await expect(
        service.requirePermissions(undefined, [Permission.ORDER_READ]),
      ).rejects.toMatchObject({ code: AuthErrorCode.UNAUTHENTICATED });
    });
  });
});

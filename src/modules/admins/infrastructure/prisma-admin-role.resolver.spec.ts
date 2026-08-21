import { randomUUID } from 'node:crypto';
import { AdminRole } from '../../../common/authz/admin-role';
import { AuthorizationService } from '../../../common/authz/authorization.service';
import { Permission } from '../../../common/authz/permission';
import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { AuthSubjectType } from '../../auth/domain/subject-type';
import type { AdminAuthorizationState } from '../domain/admin';
import type { AdminRepository } from './admin.repository';
import { PrismaAdminRoleResolver } from './prisma-admin-role.resolver';

function createResolver(
  findAuthorizationState: jest.Mock,
): PrismaAdminRoleResolver {
  return new PrismaAdminRoleResolver({
    findAuthorizationState,
  } as unknown as AdminRepository);
}

function state(
  overrides: Partial<AdminAuthorizationState> & { id: string },
): AdminAuthorizationState {
  return {
    role: AdminRole.WAREHOUSE,
    isActive: true,
    ...overrides,
  };
}

describe('PrismaAdminRoleResolver', () => {
  it('reports the persisted role and activation state for the requested admin', async () => {
    const adminId = randomUUID();
    const resolver = createResolver(
      jest.fn().mockResolvedValue(state({ id: adminId })),
    );

    await expect(resolver.findAdminAuthorization(adminId)).resolves.toEqual({
      status: 'found',
      record: { adminId, role: AdminRole.WAREHOUSE, isActive: true },
    });
  });

  it('reports a missing admin as not found', async () => {
    const resolver = createResolver(jest.fn().mockResolvedValue(null));

    await expect(
      resolver.findAdminAuthorization(randomUUID()),
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('reports an inactive admin as found rather than deciding for the authorizer', async () => {
    // One implementation of the fail-closed contract: the resolver states facts
    // and AuthorizationService applies `admin_inactive`.
    const adminId = randomUUID();
    const resolver = createResolver(
      jest
        .fn()
        .mockResolvedValue(
          state({ id: adminId, role: AdminRole.SUPER_ADMIN, isActive: false }),
        ),
    );

    await expect(resolver.findAdminAuthorization(adminId)).resolves.toEqual({
      status: 'found',
      record: { adminId, role: AdminRole.SUPER_ADMIN, isActive: false },
    });
  });

  it('answers not found for a non-uuid subject without querying', async () => {
    const findAuthorizationState = jest.fn();
    const resolver = createResolver(findAuthorizationState);

    await expect(
      resolver.findAdminAuthorization('not-a-uuid'),
    ).resolves.toEqual({ status: 'not_found' });
    expect(findAuthorizationState).not.toHaveBeenCalled();
  });

  it('lets a persistence failure propagate so the authorizer can degrade it', async () => {
    const resolver = createResolver(
      jest.fn().mockRejectedValue(new Error('connection terminated')),
    );

    await expect(resolver.findAdminAuthorization(randomUUID())).rejects.toThrow(
      /connection terminated/u,
    );
  });
});

describe('permission resolution through the real resolver seam', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as ApplicationLogger;

  function authorizationServiceOver(
    findAuthorizationState: jest.Mock,
  ): AuthorizationService {
    return new AuthorizationService(
      createResolver(findAuthorizationState),
      logger,
    );
  }

  it('grants the persisted role its catalogued permissions', async () => {
    const adminId = randomUUID();
    const service = authorizationServiceOver(
      jest
        .fn()
        .mockResolvedValue(state({ id: adminId, role: AdminRole.ORDER_OPS })),
    );

    const decision = await service.authorize(
      {
        subjectId: adminId,
        subjectType: AuthSubjectType.ADMIN,
        sessionId: randomUUID(),
      },
      [Permission.ORDER_TRANSITION],
    );

    expect(decision.granted).toBe(true);
  });

  it('denies a permission the persisted role does not hold', async () => {
    const adminId = randomUUID();
    const service = authorizationServiceOver(
      jest
        .fn()
        .mockResolvedValue(state({ id: adminId, role: AdminRole.ORDER_OPS })),
    );

    await expect(
      service.authorize(
        {
          subjectId: adminId,
          subjectType: AuthSubjectType.ADMIN,
          sessionId: randomUUID(),
        },
        [Permission.ADMIN_MANAGE],
      ),
    ).resolves.toEqual({ granted: false, reason: 'missing_permission' });
  });

  it('denies a disabled admin every permission', async () => {
    const adminId = randomUUID();
    const service = authorizationServiceOver(
      jest
        .fn()
        .mockResolvedValue(
          state({ id: adminId, role: AdminRole.SUPER_ADMIN, isActive: false }),
        ),
    );
    const principal = {
      subjectId: adminId,
      subjectType: AuthSubjectType.ADMIN,
      sessionId: randomUUID(),
    };

    await expect(
      service.authorize(principal, [Permission.CATALOG_READ]),
    ).resolves.toEqual({ granted: false, reason: 'admin_inactive' });
    await expect(service.getPermissions(principal)).resolves.toEqual(new Set());
  });

  it('denies an admin id with no persisted record', async () => {
    const service = authorizationServiceOver(jest.fn().mockResolvedValue(null));

    await expect(
      service.authorize(
        {
          subjectId: randomUUID(),
          subjectType: AuthSubjectType.ADMIN,
          sessionId: randomUUID(),
        },
        [Permission.CATALOG_READ],
      ),
    ).resolves.toEqual({ granted: false, reason: 'admin_not_found' });
  });

  it('denies a role that is not in the code-defined catalog', async () => {
    const adminId = randomUUID();
    const service = authorizationServiceOver(
      jest
        .fn()
        .mockResolvedValue({ id: adminId, role: 'ROOT', isActive: true }),
    );

    await expect(
      service.authorize(
        {
          subjectId: adminId,
          subjectType: AuthSubjectType.ADMIN,
          sessionId: randomUUID(),
        },
        [Permission.CATALOG_READ],
      ),
    ).resolves.toEqual({ granted: false, reason: 'unknown_role' });
  });

  it('never resolves admin permissions for a customer subject', async () => {
    const findAuthorizationState = jest.fn();
    const service = authorizationServiceOver(findAuthorizationState);

    await expect(
      service.getPermissions({
        subjectId: randomUUID(),
        subjectType: AuthSubjectType.USER,
        sessionId: randomUUID(),
      }),
    ).resolves.toEqual(new Set());
    // A USER subject id is never looked up as an admin id, so a customer cannot
    // collide into admin state.
    expect(findAuthorizationState).not.toHaveBeenCalled();
  });

  it('degrades a directory outage to a denial rather than a server error', async () => {
    const service = authorizationServiceOver(
      jest.fn().mockRejectedValue(new Error('connection terminated')),
    );

    await expect(
      service.authorize(
        {
          subjectId: randomUUID(),
          subjectType: AuthSubjectType.ADMIN,
          sessionId: randomUUID(),
        },
        [Permission.CATALOG_READ],
      ),
    ).resolves.toEqual({
      granted: false,
      reason: 'admin_directory_unavailable',
    });
  });
});

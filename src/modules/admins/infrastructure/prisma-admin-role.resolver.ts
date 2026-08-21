import { Injectable } from '@nestjs/common';
import type {
  AdminAuthorizationLookup,
  AdminRoleResolver,
} from '../../../common/authz/admin-role-resolver';
import { AdminRepository } from './admin.repository';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Real `AdminRoleResolver` backing the `ADMIN_ROLE_RESOLVER` seam that AUTH-08
 * created, replacing the fail-closed `AdminPersistenceUnavailableRoleResolver`.
 *
 * It reports state and makes no authorization decision. Inactive admins and
 * unrecognized roles are returned as-is so `AuthorizationService` applies the
 * single documented fail-closed contract (`admin_inactive`, `unknown_role`)
 * rather than two implementations of it. Persistence failures are allowed to
 * propagate: `AuthorizationService` degrades them to `admin_directory_unavailable`
 * with error-level telemetry, so an outage denies instead of returning a 500.
 */
@Injectable()
export class PrismaAdminRoleResolver implements AdminRoleResolver {
  constructor(private readonly admins: AdminRepository) {}

  async findAdminAuthorization(
    adminId: string,
  ): Promise<AdminAuthorizationLookup> {
    // A non-UUID subject cannot identify an admin. Answering `not_found` keeps
    // a malformed token subject on the ordinary denial path instead of turning a
    // Prisma type error into error-level "directory unavailable" noise.
    if (!UUID_PATTERN.test(adminId)) {
      return { status: 'not_found' };
    }

    const state = await this.admins.findAuthorizationState(adminId);
    if (state === null) {
      return { status: 'not_found' };
    }

    return {
      status: 'found',
      record: {
        adminId: state.id,
        role: state.role,
        isActive: state.isActive,
      },
    };
  }
}

import { Injectable } from '@nestjs/common';
import type {
  AdminAuthorizationLookup,
  AdminRoleResolver,
} from './admin-role-resolver';

/**
 * Fail-closed default {@link AdminRoleResolver} when no real implementation is
 * bound through `AuthorizationModule.forRoot()`. Every lookup reports
 * `unavailable`, so admin authorization denies instead of granting an
 * empty-or-default role.
 *
 * Production binds `PrismaAdminRoleResolver` from Admins; this class remains
 * the safe default for incomplete composition (for example a second accidental
 * `forRoot()` call with no resolver).
 */
@Injectable()
export class AdminPersistenceUnavailableRoleResolver implements AdminRoleResolver {
  findAdminAuthorization(adminId: string): Promise<AdminAuthorizationLookup> {
    void adminId;
    return Promise.resolve({ status: 'unavailable' });
  }
}

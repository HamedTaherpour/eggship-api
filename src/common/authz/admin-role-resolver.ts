/**
 * Authorization-relevant admin state, owned by whichever module persists Admin
 * identity. `role` is the persisted value and is deliberately typed as `string`
 * because it crosses a persistence boundary: `AuthorizationService` narrows it
 * and denies unrecognized roles.
 */
export interface AdminAuthorizationRecord {
  readonly adminId: string;
  readonly role: string;
  readonly isActive: boolean;
}

export type AdminAuthorizationLookup =
  | { readonly status: 'found'; readonly record: AdminAuthorizationRecord }
  | { readonly status: 'not_found' }
  /** Admin identity persistence does not exist yet, or the directory is unreachable. */
  | { readonly status: 'unavailable' };

/**
 * Port for reading admin role/activation state at authorization time.
 *
 * Access tokens carry no role or permission claims (ADR 0007), so admin
 * permissions are resolved from durable data on each authorization decision.
 */
export interface AdminRoleResolver {
  findAdminAuthorization(adminId: string): Promise<AdminAuthorizationLookup>;
}

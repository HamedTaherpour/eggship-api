/**
 * Admin roles carried forward from legacy EggShip back-office operations.
 *
 * Roles are policy configuration only: application code must never branch on a
 * role value. Authorization decisions use permissions resolved from
 * `role-permissions.ts`.
 */
export const AdminRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  WAREHOUSE: 'WAREHOUSE',
  ORDER_OPS: 'ORDER_OPS',
} as const;

export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];

export const ALL_ADMIN_ROLES: readonly AdminRole[] = Object.freeze(
  Object.values(AdminRole),
);

/**
 * Narrows a persisted role value to a known role. An unrecognized role must
 * resolve to no permissions rather than to a default grant.
 */
export function isAdminRole(value: unknown): value is AdminRole {
  return (
    typeof value === 'string' &&
    (ALL_ADMIN_ROLES as readonly string[]).includes(value)
  );
}

/** The critical administrator role is policy-owned, not a scattered branch. */
export function isCriticalAdminRole(value: AdminRole): boolean {
  return value === AdminRole.SUPER_ADMIN;
}

/** Returns the role whose active count is protected by account management. */
export function criticalAdminRole(): AdminRole {
  return AdminRole.SUPER_ADMIN;
}

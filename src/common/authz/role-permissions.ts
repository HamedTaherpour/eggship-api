import { AdminRole } from './admin-role';
import { Permission } from './permission';

/**
 * The single source of truth for role → permission policy (ADR 0007).
 *
 * `SUPER_ADMIN` is enumerated explicitly rather than derived from the catalog:
 * there is no role-based bypass anywhere in the authorization path, so adding a
 * permission is a deliberate decision for every role including this one.
 *
 * The `WAREHOUSE` and `ORDER_OPS` sets are provisional. Legacy capability
 * evidence lands with MIG-01; until then these grants are the narrowest sets
 * that keep each role's documented operational purpose usable.
 */
export const ROLE_PERMISSIONS: Readonly<
  Record<AdminRole, readonly Permission[]>
> = Object.freeze({
  [AdminRole.SUPER_ADMIN]: Object.freeze([
    Permission.CATALOG_READ,
    Permission.CATALOG_MANAGE,
    Permission.MEDIA_READ,
    Permission.MEDIA_MANAGE,
    Permission.INVENTORY_READ,
    Permission.INVENTORY_ADJUST,
    Permission.ORDER_READ,
    Permission.ORDER_TRANSITION,
    Permission.SETTLEMENT_READ,
    Permission.SETTLEMENT_MANAGE,
    Permission.DISCOUNT_READ,
    Permission.DISCOUNT_MANAGE,
    Permission.COMMERCE_POLICY_MANAGE,
    Permission.CUSTOMER_READ,
    Permission.VISITOR_READ,
    Permission.CONTENT_READ,
    Permission.CONTENT_MANAGE,
    Permission.ANALYTICS_READ,
    Permission.AUDIT_READ,
    Permission.ADMIN_READ,
    Permission.ADMIN_MANAGE,
    Permission.ASYNC_FAILURE_READ,
    Permission.ASYNC_FAILURE_REPLAY,
    Permission.ASYNC_FAILURE_MANAGE,
  ]),
  [AdminRole.WAREHOUSE]: Object.freeze([
    Permission.INVENTORY_READ,
    Permission.INVENTORY_ADJUST,
    Permission.CATALOG_READ,
    Permission.MEDIA_READ,
    Permission.ORDER_READ,
  ]),
  [AdminRole.ORDER_OPS]: Object.freeze([
    Permission.ORDER_READ,
    Permission.ORDER_TRANSITION,
    Permission.INVENTORY_READ,
    Permission.CATALOG_READ,
    Permission.CUSTOMER_READ,
  ]),
});

/** Resolves the effective permission set for a known role. */
export function permissionsForRole(role: AdminRole): ReadonlySet<Permission> {
  return new Set(ROLE_PERMISSIONS[role]);
}

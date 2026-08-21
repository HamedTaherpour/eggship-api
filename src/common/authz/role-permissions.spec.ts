import { ALL_ADMIN_ROLES, AdminRole, isAdminRole } from './admin-role';
import { ALL_PERMISSIONS, Permission, isPermission } from './permission';
import { ROLE_PERMISSIONS, permissionsForRole } from './role-permissions';

describe('permission catalog', () => {
  it('uses stable domain-oriented identifiers matching their keys', () => {
    for (const [key, value] of Object.entries(Permission)) {
      expect(value).toBe(key);
      expect(value).toMatch(/^[A-Z][A-Z_]*[A-Z]$/u);
    }
  });

  it('rejects unknown values so unrecognized permissions cannot be coerced', () => {
    expect(isPermission(Permission.ORDER_READ)).toBe(true);
    expect(isPermission('ORDER_READ_WRITE')).toBe(false);
    expect(isPermission('order_read')).toBe(false);
    expect(isPermission('ADMIN_ALL')).toBe(false);
    expect(isPermission(undefined)).toBe(false);
    expect(isPermission(null)).toBe(false);
    expect(isPermission(42)).toBe(false);
  });
});

describe('admin roles', () => {
  it('rejects unknown role values', () => {
    expect(isAdminRole(AdminRole.WAREHOUSE)).toBe(true);
    expect(isAdminRole('warehouse')).toBe(false);
    expect(isAdminRole('ROOT')).toBe(false);
    expect(isAdminRole('')).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });
});

describe('role to permission mapping', () => {
  it('defines a policy for every role and only known permissions', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(
      [...ALL_ADMIN_ROLES].sort(),
    );
    for (const role of ALL_ADMIN_ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(isPermission(permission)).toBe(true);
      }
      expect(new Set(ROLE_PERMISSIONS[role]).size).toBe(
        ROLE_PERMISSIONS[role].length,
      );
    }
  });

  // This fails until SUPER_ADMIN's grant for a newly added permission is
  // explicitly listed. Withholding one from SUPER_ADMIN is a deliberate change
  // to this assertion, not something that can happen by omission.
  it('grants SUPER_ADMIN every permission through explicit policy, not a bypass', () => {
    expect(new Set(ROLE_PERMISSIONS[AdminRole.SUPER_ADMIN])).toEqual(
      new Set(ALL_PERMISSIONS),
    );
  });

  it('reserves admin management for SUPER_ADMIN', () => {
    const others = ALL_ADMIN_ROLES.filter(
      (role) => role !== AdminRole.SUPER_ADMIN,
    );
    expect(others).not.toEqual([]);
    for (const role of others) {
      const permissions = permissionsForRole(role);
      expect(permissions.has(Permission.ADMIN_MANAGE)).toBe(false);
      expect(permissions.has(Permission.ADMIN_READ)).toBe(false);
    }
  });

  it('keeps WAREHOUSE to inventory-oriented capabilities', () => {
    const warehouse = permissionsForRole(AdminRole.WAREHOUSE);
    expect(warehouse.has(Permission.INVENTORY_READ)).toBe(true);
    expect(warehouse.has(Permission.INVENTORY_ADJUST)).toBe(true);
    expect(warehouse.has(Permission.ORDER_TRANSITION)).toBe(false);
    expect(warehouse.has(Permission.ADMIN_READ)).toBe(false);
    expect(warehouse.has(Permission.ADMIN_MANAGE)).toBe(false);
    expect(warehouse.has(Permission.CATALOG_MANAGE)).toBe(false);
    expect(warehouse.has(Permission.DISCOUNT_MANAGE)).toBe(false);
  });

  it('keeps ORDER_OPS to order operations without inventory mutation', () => {
    const orderOps = permissionsForRole(AdminRole.ORDER_OPS);
    expect(orderOps.has(Permission.ORDER_READ)).toBe(true);
    expect(orderOps.has(Permission.ORDER_TRANSITION)).toBe(true);
    expect(orderOps.has(Permission.INVENTORY_READ)).toBe(true);
    expect(orderOps.has(Permission.INVENTORY_ADJUST)).toBe(false);
    expect(orderOps.has(Permission.ADMIN_MANAGE)).toBe(false);
    expect(orderOps.has(Permission.AUDIT_READ)).toBe(false);
  });

  it('returns a fresh set per call so shared policy cannot be mutated', () => {
    expect(permissionsForRole(AdminRole.WAREHOUSE)).not.toBe(
      permissionsForRole(AdminRole.WAREHOUSE),
    );
    expect(Object.isFrozen(ROLE_PERMISSIONS)).toBe(true);
    for (const role of ALL_ADMIN_ROLES) {
      expect(Object.isFrozen(ROLE_PERMISSIONS[role])).toBe(true);
    }
  });
});

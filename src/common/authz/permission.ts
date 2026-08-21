/**
 * Admin authorization actions. Permissions — not roles — are the authorization
 * primitive; roles are policy configuration that groups permissions.
 *
 * This is the AUTH-08 seed catalog, derived from the legacy admin capability
 * domains in the `docs/ROADMAP.md` legacy/new-capability coverage table, plus
 * the audit capability defined by the AUD-01/AUD-03 tasks (the coverage table
 * has no audit row). Granularity inside a domain stays coarse until the owning
 * roadmap task has evidence for finer actions; that task extends the catalog.
 * A permission that no endpoint requires grants nothing.
 */
export const Permission = {
  /** Categories, regions, and products (CAT-02, CAT-03, CAT-05). */
  CATALOG_READ: 'CATALOG_READ',
  CATALOG_MANAGE: 'CATALOG_MANAGE',
  /** Media library metadata and files (CAT-04, MED-01). */
  MEDIA_READ: 'MEDIA_READ',
  MEDIA_MANAGE: 'MEDIA_MANAGE',
  /** Stock balances, ledger, receiving, and adjustments (INV-01–INV-06). */
  INVENTORY_READ: 'INVENTORY_READ',
  INVENTORY_ADJUST: 'INVENTORY_ADJUST',
  /** Admin order views and state transitions (ORD-06, ORD-07). */
  ORDER_READ: 'ORDER_READ',
  ORDER_TRANSITION: 'ORDER_TRANSITION',
  /** Discount lifecycle and pricing administration (PRC-02–PRC-04). */
  DISCOUNT_READ: 'DISCOUNT_READ',
  DISCOUNT_MANAGE: 'DISCOUNT_MANAGE',
  /** Store/customer back-office views (ADM-02). */
  CUSTOMER_READ: 'CUSTOMER_READ',
  /** Visitor and referral administration views (REF-04). */
  VISITOR_READ: 'VISITOR_READ',
  /** Blog/content administration (CNT-02). */
  CONTENT_READ: 'CONTENT_READ',
  CONTENT_MANAGE: 'CONTENT_MANAGE',
  /** Analytics reads (ANL-02, ANL-03). */
  ANALYTICS_READ: 'ANALYTICS_READ',
  /** Audit trail reads (AUD-03). */
  AUDIT_READ: 'AUDIT_READ',
  /** Admin account administration (ADM-01). */
  ADMIN_READ: 'ADMIN_READ',
  ADMIN_MANAGE: 'ADMIN_MANAGE',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

/** Every approved admin permission. Used to validate role policy completeness. */
export const ALL_PERMISSIONS: readonly Permission[] = Object.freeze(
  Object.values(Permission),
);

/**
 * Narrows an untrusted value (persisted data, reflected metadata) to a known
 * permission. Unknown values must be denied, never coerced.
 */
export function isPermission(value: unknown): value is Permission {
  return (
    typeof value === 'string' &&
    (ALL_PERMISSIONS as readonly string[]).includes(value)
  );
}

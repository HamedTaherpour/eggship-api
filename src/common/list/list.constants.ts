/** Canonical default for `page` (1-based). */
export const DEFAULT_PAGE = 1;

/** Canonical default for `pageSize`. */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Maximum allowed `pageSize`. Reject values above this rather than clamping.
 * Protects ordinary Admin/public list endpoints from unbounded result sets.
 */
export const MAX_PAGE_SIZE = 100;

/** Default maximum length for the optional `search` query parameter. */
export const DEFAULT_SEARCH_MAX_LENGTH = 200;

/** Allowed `sortOrder` values. */
export const SORT_ORDERS = ['asc', 'desc'] as const;

export type SortOrder = (typeof SORT_ORDERS)[number];

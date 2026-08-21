/**
 * Naming convention for optional inclusive/exclusive date-range filters.
 *
 * Resources opt in explicitly. Do not assume every list supports date filters.
 * Generic list primitives do not implement a date-filter DSL.
 *
 * Prefer ISO 8601 instant strings (UTC). Inclusive vs exclusive bounds and any
 * business-day / Tehran timezone semantics are owned by the resource — never
 * encoded in common list utilities.
 *
 * @example
 * `?createdFrom=2026-01-01T00:00:00.000Z&createdTo=2026-01-31T23:59:59.999Z`
 */
export type DateRangeQueryConvention = {
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
};

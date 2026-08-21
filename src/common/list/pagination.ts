import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from './list.constants';

/** Neutral pagination intent after validation and defaults. */
export interface PageRequest {
  page: number;
  pageSize: number;
}

/** Neutral repository page result before HTTP envelope mapping. */
export interface PageResult<T> {
  items: T[];
  total: number;
}

/** Canonical list response metadata. */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Canonical paginated HTTP envelope. */
export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface PaginationQueryInput {
  page?: number;
  pageSize?: number;
}

/**
 * Apply canonical defaults to an optional pagination query.
 * Call only after DTO validation has accepted or omitted the fields.
 */
export function resolvePageRequest(
  query: PaginationQueryInput = {},
): PageRequest {
  return {
    page: query.page ?? DEFAULT_PAGE,
    pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
  };
}

/** Offset/limit pair for persistence adapters (not Prisma-typed). */
export function toSkipTake(pageRequest: PageRequest): {
  skip: number;
  take: number;
} {
  return {
    skip: (pageRequest.page - 1) * pageRequest.pageSize,
    take: pageRequest.pageSize,
  };
}

/**
 * Total page count for a known result size.
 * `total === 0` yields `0` (not `1`).
 */
export function calculateTotalPages(total: number, pageSize: number): number {
  if (total <= 0) {
    return 0;
  }
  if (pageSize < 1) {
    throw new RangeError('pageSize must be >= 1');
  }
  return Math.ceil(total / pageSize);
}

export function buildPaginationMeta(
  pageRequest: PageRequest,
  total: number,
): PaginationMeta {
  if (total < 0) {
    throw new RangeError('total must be >= 0');
  }
  return {
    page: pageRequest.page,
    pageSize: pageRequest.pageSize,
    total,
    totalPages: calculateTotalPages(total, pageRequest.pageSize),
  };
}

/**
 * Build the canonical `{ data, meta }` list envelope.
 * Deterministic; no business logic; does not mutate `items`.
 */
export function toPaginatedResponse<T>(
  items: readonly T[],
  pageRequest: PageRequest,
  total: number,
): PaginatedResponse<T> {
  return {
    data: [...items],
    meta: buildPaginationMeta(pageRequest, total),
  };
}

/** Re-export limit constant for OpenAPI / docs consumers. */
export { MAX_PAGE_SIZE };

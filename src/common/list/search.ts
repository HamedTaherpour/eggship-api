import { DEFAULT_SEARCH_MAX_LENGTH } from './list.constants';

export interface NormalizeSearchOptions {
  /** Maximum length after trim. Defaults to {@link DEFAULT_SEARCH_MAX_LENGTH}. */
  maxLength?: number;
}

/**
 * Basic search normalization for list query DTOs.
 *
 * - Trims surrounding whitespace
 * - Treats empty / whitespace-only input as absent (`undefined`)
 * - Does **not** apply domain-specific normalization (phone, SKU, etc.)
 *
 * Resources must define which fields are searchable; this helper never implies
 * "search every column."
 *
 * Non-string values are returned unchanged so `@IsString()` can reject them.
 */
export function normalizeSearch(
  value: unknown,
  options: NormalizeSearchOptions = {},
): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const maxLength = options.maxLength ?? DEFAULT_SEARCH_MAX_LENGTH;
  if (trimmed.length > maxLength) {
    // Leave the trimmed value for `@MaxLength` to reject with a clear message.
    return trimmed;
  }

  return trimmed;
}

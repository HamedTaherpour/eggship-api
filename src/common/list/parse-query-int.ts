/**
 * Strict integer coercion for HTTP query values.
 *
 * Accepts only decimal integer strings (optional leading `-`) or already-safe
 * integers. Rejects decimals, scientific notation, hex, trailing junk, NaN,
 * and Infinity by returning a non-integer so `@IsInt()` fails.
 *
 * Empty / absent values become `undefined` so optional defaults can apply.
 */
export function parseQueryInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value : Number.NaN;
  }

  if (typeof value !== 'string') {
    return Number.NaN;
  }

  if (!/^-?\d+$/u.test(value)) {
    return Number.NaN;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

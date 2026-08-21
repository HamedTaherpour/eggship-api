/**
 * Strict boolean coercion for HTTP query values.
 *
 * Accepts only `true` / `false` (boolean or lowercase string). Does not treat
 * `1`, `0`, `yes`, `no`, or other truthy strings as booleans — those remain
 * unchanged so `@IsBoolean()` rejects them.
 *
 * Empty / absent values become `undefined`.
 */
export function parseQueryBoolean(value: unknown): unknown {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  // Preserve the original value so class-validator can reject it.
  return value;
}

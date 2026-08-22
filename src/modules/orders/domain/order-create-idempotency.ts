import { createHash } from 'node:crypto';

/**
 * Canonical SHA-256 of the logical create request for ORD-03 idempotency.
 * Same user + key + same hash → replay; same key + different hash → conflict.
 */
export function hashOrderCreatePayload(input: {
  regionId: string;
  lines: ReadonlyArray<{ productId: string; quantity: number }>;
}): string {
  const lines = [...input.lines]
    .map((line) => ({
      productId: line.productId.toLowerCase(),
      quantity: line.quantity,
    }))
    .sort((left, right) => left.productId.localeCompare(right.productId));

  const canonical = JSON.stringify({
    regionId: input.regionId.toLowerCase(),
    lines,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

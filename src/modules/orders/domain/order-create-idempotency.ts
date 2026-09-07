import { createHash } from 'node:crypto';

/**
 * Canonical SHA-256 of the logical create request for ORD-03 idempotency.
 * Same user + key + same hash → replay; same key + different hash → conflict.
 */
export function hashOrderCreatePayload(input: {
  regionId: string;
  customerNote?: string | null;
  lines: ReadonlyArray<{ productId: string; quantity: number }>;
}): string {
  const lines = [...input.lines]
    .map((line) => ({
      productId: line.productId.toLowerCase(),
      quantity: line.quantity,
    }))
    .sort((left, right) => left.productId.localeCompare(right.productId));

  const canonicalPayload: {
    regionId: string;
    lines: ReadonlyArray<{ productId: string; quantity: number }>;
    customerNote?: string;
  } = {
    regionId: input.regionId.toLowerCase(),
    lines,
  };
  const customerNote = normalizeCustomerNote(input.customerNote);
  if (customerNote !== null) {
    canonicalPayload.customerNote = customerNote;
  }
  const canonical = JSON.stringify(canonicalPayload);
  return createHash('sha256').update(canonical).digest('hex');
}

export function normalizeCustomerNote(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

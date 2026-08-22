import { createHash } from 'node:crypto';

export const InventoryCommandOperation = {
  RECEIVE: 'RECEIVE',
  ADJUST: 'ADJUST',
} as const;

export type InventoryCommandOperation =
  (typeof InventoryCommandOperation)[keyof typeof InventoryCommandOperation];

export const InventoryCommandIdempotencyStatus = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
} as const;

export type InventoryCommandIdempotencyStatus =
  (typeof InventoryCommandIdempotencyStatus)[keyof typeof InventoryCommandIdempotencyStatus];

export interface InventoryCommandIdempotencyRecord {
  id: string;
  idempotencyKey: string;
  operation: InventoryCommandOperation;
  productId: string;
  payloadHash: string;
  status: InventoryCommandIdempotencyStatus;
  onHandAfter: number | null;
  reservedAfter: number | null;
  ledgerId: string | null;
  createdAt: Date;
}

function stableHash(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload).sort();
  const canonical = JSON.stringify(
    Object.fromEntries(keys.map((key) => [key, payload[key]])),
  );
  return createHash('sha256').update(canonical).digest('hex');
}

export function hashReceivePayload(input: {
  productId: string;
  quantity: number;
}): string {
  return stableHash({
    operation: InventoryCommandOperation.RECEIVE,
    productId: input.productId,
    quantity: input.quantity,
  });
}

export function hashAdjustPayload(input: {
  productId: string;
  delta: number;
  reason: string;
}): string {
  return stableHash({
    operation: InventoryCommandOperation.ADJUST,
    productId: input.productId,
    delta: input.delta,
    reason: input.reason,
  });
}

export function toBalanceFromIdempotency(
  record: InventoryCommandIdempotencyRecord,
): {
  productId: string;
  onHand: number;
  reserved: number;
  available: number;
} {
  if (
    record.onHandAfter === null ||
    record.reservedAfter === null ||
    record.status !== InventoryCommandIdempotencyStatus.COMPLETED
  ) {
    throw new Error(
      'Completed idempotency record is missing balance snapshot.',
    );
  }
  return {
    productId: record.productId,
    onHand: record.onHandAfter,
    reserved: record.reservedAfter,
    available: record.onHandAfter - record.reservedAfter,
  };
}

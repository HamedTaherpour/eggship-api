import { createHash } from 'node:crypto';
import { OrderInvalidInputError } from './order-errors';

export const ORDER_RETURN_REASON_MAX_LENGTH = 500;

export interface OrderReturnLineInput {
  orderLineId: string;
  sellableQuantity: number;
  damagedQuantity: number;
}

export interface CreateOrderReturnInput {
  orderId: string;
  recordedByAdminId: string;
  reason: string;
  idempotencyKey: string;
  idempotencyPayloadHash: string;
  lines: readonly OrderReturnLineInput[];
}

export interface OrderReturnLineRecord extends OrderReturnLineInput {
  id: string;
  returnId: string;
  createdAt: Date;
}

export interface OrderReturnRecord {
  id: string;
  orderId: string;
  recordedByAdminId: string;
  reason: string;
  idempotencyKey: string;
  idempotencyPayloadHash: string;
  createdAt: Date;
  lines: OrderReturnLineRecord[];
}

export function normalizeOrderReturnReason(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new OrderInvalidInputError('Return reason is required.');
  }
  const reason = raw.trim();
  if (reason.length < 1 || reason.length > ORDER_RETURN_REASON_MAX_LENGTH) {
    throw new OrderInvalidInputError('Return reason is required.');
  }
  return reason;
}

export function assertOrderReturnLineQuantities(
  line: OrderReturnLineInput,
): void {
  if (
    !Number.isSafeInteger(line.sellableQuantity) ||
    line.sellableQuantity < 0 ||
    !Number.isSafeInteger(line.damagedQuantity) ||
    line.damagedQuantity < 0
  ) {
    throw new OrderInvalidInputError(
      'Return quantities must be non-negative integers.',
    );
  }
  if (line.sellableQuantity + line.damagedQuantity <= 0) {
    throw new OrderInvalidInputError(
      'A return line must contain returned quantity.',
    );
  }
}

export function assertOrderReturnInput(input: CreateOrderReturnInput): void {
  normalizeOrderReturnReason(input.reason);
  if (input.lines.length === 0) {
    throw new OrderInvalidInputError('At least one return line is required.');
  }
  const seenOrderLineIds = new Set<string>();
  for (const line of input.lines) {
    if (seenOrderLineIds.has(line.orderLineId)) {
      throw new OrderInvalidInputError(
        'Each order line may appear only once in a return.',
      );
    }
    seenOrderLineIds.add(line.orderLineId);
    assertOrderReturnLineQuantities(line);
  }
}

/** Stable proof over only the caller-supplied return command fields. */
export function hashOrderReturnPayload(input: {
  orderId: string;
  reason: string;
  lines: readonly OrderReturnLineInput[];
}): string {
  const canonical = JSON.stringify({
    orderId: input.orderId.toLowerCase(),
    reason: normalizeOrderReturnReason(input.reason),
    lines: [...input.lines]
      .map((line) => ({
        orderLineId: line.orderLineId.toLowerCase(),
        sellableQuantity: line.sellableQuantity,
        damagedQuantity: line.damagedQuantity,
      }))
      .sort((left, right) => left.orderLineId.localeCompare(right.orderLineId)),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

import { InventoryInvalidAdjustmentError } from './inventory-errors';
import { InventoryInvalidQuantityError } from './inventory-errors';
import { assertInventoryUuid } from './inventory-quantity';

export const InventoryLedgerType = {
  RECEIVE: 'RECEIVE',
  ADJUST: 'ADJUST',
  RESERVE: 'RESERVE',
  RELEASE: 'RELEASE',
  SHIP: 'SHIP',
  RETURN_TO_STOCK: 'RETURN_TO_STOCK',
  WRITE_OFF: 'WRITE_OFF',
} as const;

export type InventoryLedgerType =
  (typeof InventoryLedgerType)[keyof typeof InventoryLedgerType];

export const InventoryLedgerReferenceType = {
  ORDER: 'ORDER',
  RECEIVE: 'RECEIVE',
  ADJUSTMENT: 'ADJUSTMENT',
  RETURN: 'RETURN',
  RECONCILIATION: 'RECONCILIATION',
} as const;

export type InventoryLedgerReferenceType =
  (typeof InventoryLedgerReferenceType)[keyof typeof InventoryLedgerReferenceType];

export const InventoryLedgerActorType = {
  USER: 'USER',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM',
} as const;

export type InventoryLedgerActorType =
  (typeof InventoryLedgerActorType)[keyof typeof InventoryLedgerActorType];

export interface InventoryActor {
  type: InventoryLedgerActorType;
  id: string | null;
}

export interface InventoryLedgerEntry {
  id: string;
  productId: string;
  type: InventoryLedgerType;
  quantity: number;
  onHandDelta: number;
  reservedDelta: number;
  onHandAfter: number;
  reservedAfter: number;
  referenceType: InventoryLedgerReferenceType;
  referenceId: string | null;
  reason: string | null;
  actorType: InventoryLedgerActorType;
  actorId: string | null;
  correlationId: string | null;
  createdAt: Date;
}

export const LEDGER_REASON_MAX_LENGTH = 500;

export function normalizeLedgerReason(
  raw: string | null | undefined,
): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > LEDGER_REASON_MAX_LENGTH) {
    throw new InventoryInvalidAdjustmentError(
      `Reason must be at most ${LEDGER_REASON_MAX_LENGTH} characters.`,
    );
  }
  return trimmed;
}

export function assertLedgerActor(actor: InventoryActor): InventoryActor {
  if (actor.type === InventoryLedgerActorType.SYSTEM) {
    if (actor.id !== null) {
      throw new InventoryInvalidAdjustmentError(
        'System inventory actions must not carry an actor id.',
      );
    }
    return actor;
  }
  if (actor.id === null) {
    throw new InventoryInvalidAdjustmentError(
      'User and admin inventory actions require an actor id.',
    );
  }
  return { type: actor.type, id: assertInventoryUuid(actor.id, 'actorId') };
}

export function assertRequiredReason(
  type: InventoryLedgerType,
  reason: string | null,
): void {
  if (
    (type === InventoryLedgerType.ADJUST ||
      type === InventoryLedgerType.WRITE_OFF) &&
    reason === null
  ) {
    throw new InventoryInvalidAdjustmentError(
      'A reason is required for adjustments and write-offs.',
    );
  }
}

export function expectedDeltasForType(
  type: InventoryLedgerType,
  quantity: number,
  adjustmentDelta?: number,
): { onHandDelta: number; reservedDelta: number } {
  switch (type) {
    case InventoryLedgerType.RECEIVE:
    case InventoryLedgerType.RETURN_TO_STOCK:
      return { onHandDelta: quantity, reservedDelta: 0 };
    case InventoryLedgerType.WRITE_OFF:
      return { onHandDelta: -quantity, reservedDelta: 0 };
    case InventoryLedgerType.RESERVE:
      return { onHandDelta: 0, reservedDelta: quantity };
    case InventoryLedgerType.RELEASE:
      return { onHandDelta: 0, reservedDelta: -quantity };
    case InventoryLedgerType.SHIP:
      return { onHandDelta: -quantity, reservedDelta: -quantity };
    case InventoryLedgerType.ADJUST:
      if (adjustmentDelta === undefined) {
        throw new InventoryInvalidQuantityError(
          'Adjustment delta is required for ADJUST ledger rows.',
        );
      }
      return { onHandDelta: adjustmentDelta, reservedDelta: 0 };
    default: {
      const exhaustive: never = type;
      throw new InventoryInvalidQuantityError(
        `Unsupported ledger type: ${String(exhaustive)}`,
      );
    }
  }
}

export function assertLedgerDeltasMatchType(entry: {
  type: InventoryLedgerType;
  quantity: number;
  onHandDelta: number;
  reservedDelta: number;
  onHandAfter: number;
  reservedAfter: number;
}): void {
  const expected = expectedDeltasForType(
    entry.type,
    entry.quantity,
    entry.type === InventoryLedgerType.ADJUST ? entry.onHandDelta : undefined,
  );
  if (
    entry.onHandDelta !== expected.onHandDelta ||
    entry.reservedDelta !== expected.reservedDelta
  ) {
    throw new InventoryInvalidQuantityError(
      'Ledger deltas do not match the event type.',
    );
  }
  if (entry.onHandAfter < 0 || entry.reservedAfter < 0) {
    throw new InventoryInvalidQuantityError(
      'Ledger after-balances must be non-negative.',
    );
  }
  if (entry.reservedAfter > entry.onHandAfter) {
    throw new InventoryInvalidQuantityError(
      'Ledger reserved-after cannot exceed on-hand-after.',
    );
  }
}

import { deriveAvailable } from './inventory-quantity';
import {
  InventoryLedgerReferenceType,
  InventoryLedgerType,
  type InventoryLedgerEntry,
} from './inventory-ledger';
import {
  InventoryReservationStatus,
  type InventoryReservation,
} from './inventory-reservation';

export const InventoryReconciliationStatus = {
  CONSISTENT: 'CONSISTENT',
  INCONSISTENT: 'INCONSISTENT',
} as const;

export type InventoryReconciliationStatus =
  (typeof InventoryReconciliationStatus)[keyof typeof InventoryReconciliationStatus];

/** Stable operator-facing reconciliation issue codes (INV-05). */
export const InventoryReconciliationIssueCode = {
  BALANCE_INVARIANT_VIOLATION:
    'INVENTORY_RECONCILIATION_BALANCE_INVARIANT_VIOLATION',
  RESERVED_MISMATCH: 'INVENTORY_RECONCILIATION_RESERVED_MISMATCH',
  LEDGER_BALANCE_MISMATCH: 'INVENTORY_RECONCILIATION_LEDGER_BALANCE_MISMATCH',
  INVALID_LEDGER_SEQUENCE: 'INVENTORY_RECONCILIATION_INVALID_LEDGER_SEQUENCE',
  RESERVATION_LEDGER_MISMATCH:
    'INVENTORY_RECONCILIATION_RESERVATION_LEDGER_MISMATCH',
  ORPHAN_RESERVATION: 'INVENTORY_RECONCILIATION_ORPHAN_RESERVATION',
} as const;

export type InventoryReconciliationIssueCode =
  (typeof InventoryReconciliationIssueCode)[keyof typeof InventoryReconciliationIssueCode];

export interface InventoryReconciliationIssue {
  code: InventoryReconciliationIssueCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface InventoryReconciliationBalanceSnapshot {
  onHand: number;
  reserved: number;
  available: number;
}

export interface InventoryReconciliationExpectedSnapshot {
  reservedFromReservations: number;
  onHandFromLedger: number | null;
  reservedFromLedger: number | null;
}

export interface InventoryReconciliationResult {
  productId: string;
  status: InventoryReconciliationStatus;
  current: InventoryReconciliationBalanceSnapshot;
  expected: InventoryReconciliationExpectedSnapshot;
  issues: InventoryReconciliationIssue[];
  checkedAt: Date;
}

export interface ReconcileInventorySnapshotInput {
  productId: string;
  onHand: number;
  reserved: number;
  reservations: readonly InventoryReservation[];
  ledger: readonly InventoryLedgerEntry[];
  checkedAt: Date;
}

const ORDER_LIFECYCLE_TYPES = new Set<
  (typeof InventoryLedgerType)[keyof typeof InventoryLedgerType]
>([
  InventoryLedgerType.RESERVE,
  InventoryLedgerType.RELEASE,
  InventoryLedgerType.SHIP,
]);

interface OrderLifecycleEvents {
  reserve: boolean;
  release: boolean;
  ship: boolean;
}

/**
 * Pure reconciliation over one coherent snapshot. Makes no writes.
 * Baseline: Inventory rows start at 0/0 and all approved mutations append ledger.
 */
export function reconcileInventorySnapshot(
  input: ReconcileInventorySnapshotInput,
): InventoryReconciliationResult {
  const issues: InventoryReconciliationIssue[] = [];
  const { onHand, reserved } = input;
  const available = deriveAvailable(onHand, reserved);

  checkBalanceInvariants(onHand, reserved, issues);

  const reservedFromReservations = sumActiveReservationQuantity(
    input.reservations,
  );
  if (reservedFromReservations !== reserved) {
    issues.push({
      code: InventoryReconciliationIssueCode.RESERVED_MISMATCH,
      message:
        'Aggregate reserved quantity does not match the sum of ACTIVE reservations.',
      details: {
        currentReserved: reserved,
        activeReservationTotal: reservedFromReservations,
      },
    });
  }

  const orderedLedger = sortLedgerDeterministically(input.ledger);
  const ledgerTotals = reconstructFromLedgerDeltas(orderedLedger);
  const onHandFromLedger =
    orderedLedger.length === 0 ? null : ledgerTotals.onHand;
  const reservedFromLedger =
    orderedLedger.length === 0 ? null : ledgerTotals.reserved;

  if (orderedLedger.length === 0) {
    if (onHand !== 0 || reserved !== 0) {
      issues.push({
        code: InventoryReconciliationIssueCode.LEDGER_BALANCE_MISMATCH,
        message:
          'Current inventory balance is non-zero but no ledger history exists for this product.',
        details: { onHand, reserved },
      });
    }
  } else {
    checkLedgerSequence(orderedLedger, issues);
    checkLedgerTailMatchesCurrent(
      orderedLedger,
      onHand,
      reserved,
      ledgerTotals,
      issues,
    );
  }

  const lifecycleByOrder = indexOrderLifecycleEvents(orderedLedger);
  checkReservationLedgerLifecycle(input.reservations, lifecycleByOrder, issues);

  return {
    productId: input.productId,
    status:
      issues.length === 0
        ? InventoryReconciliationStatus.CONSISTENT
        : InventoryReconciliationStatus.INCONSISTENT,
    current: { onHand, reserved, available },
    expected: {
      reservedFromReservations,
      onHandFromLedger,
      reservedFromLedger,
    },
    issues,
    checkedAt: input.checkedAt,
  };
}

export function sortLedgerDeterministically(
  ledger: readonly InventoryLedgerEntry[],
): InventoryLedgerEntry[] {
  return [...ledger].sort((left, right) => {
    const byTime = left.createdAt.getTime() - right.createdAt.getTime();
    if (byTime !== 0) {
      return byTime;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

function checkBalanceInvariants(
  onHand: number,
  reserved: number,
  issues: InventoryReconciliationIssue[],
): void {
  const violations: string[] = [];
  if (onHand < 0) {
    violations.push('onHand is negative');
  }
  if (reserved < 0) {
    violations.push('reserved is negative');
  }
  if (reserved > onHand) {
    violations.push('reserved exceeds onHand');
  }
  if (violations.length === 0) {
    return;
  }
  issues.push({
    code: InventoryReconciliationIssueCode.BALANCE_INVARIANT_VIOLATION,
    message: 'Current inventory balance violates quantity invariants.',
    details: { onHand, reserved, violations },
  });
}

function sumActiveReservationQuantity(
  reservations: readonly InventoryReservation[],
): number {
  return reservations
    .filter((row) => row.status === InventoryReservationStatus.ACTIVE)
    .reduce((sum, row) => sum + row.quantity, 0);
}

function reconstructFromLedgerDeltas(ledger: readonly InventoryLedgerEntry[]): {
  onHand: number;
  reserved: number;
} {
  let onHand = 0;
  let reserved = 0;
  for (const row of ledger) {
    onHand += row.onHandDelta;
    reserved += row.reservedDelta;
  }
  return { onHand, reserved };
}

function checkLedgerSequence(
  ledger: readonly InventoryLedgerEntry[],
  issues: InventoryReconciliationIssue[],
): void {
  let previousOnHand = 0;
  let previousReserved = 0;
  for (const [index, row] of ledger.entries()) {
    const expectedOnHand = previousOnHand + row.onHandDelta;
    const expectedReserved = previousReserved + row.reservedDelta;
    if (
      row.onHandAfter !== expectedOnHand ||
      row.reservedAfter !== expectedReserved
    ) {
      issues.push({
        code: InventoryReconciliationIssueCode.INVALID_LEDGER_SEQUENCE,
        message:
          'Ledger after-balance chain is broken for this product history.',
        details: {
          ledgerId: row.id,
          sequenceIndex: index,
          expectedOnHandAfter: expectedOnHand,
          expectedReservedAfter: expectedReserved,
          actualOnHandAfter: row.onHandAfter,
          actualReservedAfter: row.reservedAfter,
        },
      });
      return;
    }
    previousOnHand = row.onHandAfter;
    previousReserved = row.reservedAfter;
  }
}

function checkLedgerTailMatchesCurrent(
  ledger: readonly InventoryLedgerEntry[],
  onHand: number,
  reserved: number,
  ledgerTotals: { onHand: number; reserved: number },
  issues: InventoryReconciliationIssue[],
): void {
  const tail = ledger[ledger.length - 1]!;
  const tailMismatch =
    tail.onHandAfter !== onHand || tail.reservedAfter !== reserved;
  const deltaMismatch =
    ledgerTotals.onHand !== onHand || ledgerTotals.reserved !== reserved;

  if (!tailMismatch && !deltaMismatch) {
    return;
  }

  issues.push({
    code: InventoryReconciliationIssueCode.LEDGER_BALANCE_MISMATCH,
    message:
      'Reconstructed ledger balances do not match the current inventory row.',
    details: {
      currentOnHand: onHand,
      currentReserved: reserved,
      deltaSumOnHand: ledgerTotals.onHand,
      deltaSumReserved: ledgerTotals.reserved,
      tailOnHandAfter: tail.onHandAfter,
      tailReservedAfter: tail.reservedAfter,
    },
  });
}

function indexOrderLifecycleEvents(
  ledger: readonly InventoryLedgerEntry[],
): Map<string, OrderLifecycleEvents> {
  const byOrder = new Map<string, OrderLifecycleEvents>();
  for (const row of ledger) {
    if (row.referenceType !== InventoryLedgerReferenceType.ORDER) {
      continue;
    }
    if (!ORDER_LIFECYCLE_TYPES.has(row.type)) {
      continue;
    }
    if (row.referenceId === null) {
      continue;
    }
    const key = row.referenceId;
    const events = byOrder.get(key) ?? {
      reserve: false,
      release: false,
      ship: false,
    };
    if (row.type === InventoryLedgerType.RESERVE) {
      events.reserve = true;
    } else if (row.type === InventoryLedgerType.RELEASE) {
      events.release = true;
    } else if (row.type === InventoryLedgerType.SHIP) {
      events.ship = true;
    }
    byOrder.set(key, events);
  }
  return byOrder;
}

function checkReservationLedgerLifecycle(
  reservations: readonly InventoryReservation[],
  lifecycleByOrder: ReadonlyMap<string, OrderLifecycleEvents>,
  issues: InventoryReconciliationIssue[],
): void {
  for (const reservation of reservations) {
    const events = lifecycleByOrder.get(reservation.orderId) ?? {
      reserve: false,
      release: false,
      ship: false,
    };

    if (events.release && events.ship) {
      issues.push({
        code: InventoryReconciliationIssueCode.ORPHAN_RESERVATION,
        message:
          'Both RELEASE and SHIP ledger events exist for the same order reservation.',
        details: {
          orderId: reservation.orderId,
          reservationStatus: reservation.status,
        },
      });
      continue;
    }

    const mismatch = expectedLifecycleMismatch(reservation.status, events);
    if (mismatch !== null) {
      issues.push({
        code: InventoryReconciliationIssueCode.RESERVATION_LEDGER_MISMATCH,
        message: mismatch,
        details: {
          orderId: reservation.orderId,
          reservationStatus: reservation.status,
          ledgerEvents: events,
        },
      });
    }
  }
}

function expectedLifecycleMismatch(
  status: InventoryReservationStatus,
  events: OrderLifecycleEvents,
): string | null {
  switch (status) {
    case InventoryReservationStatus.ACTIVE:
      if (!events.reserve) {
        return 'ACTIVE reservation is missing a RESERVE ledger event.';
      }
      if (events.release || events.ship) {
        return 'ACTIVE reservation has terminal lifecycle ledger events.';
      }
      return null;
    case InventoryReservationStatus.RELEASED:
      if (!events.reserve || !events.release || events.ship) {
        return 'RELEASED reservation does not match expected RESERVE/RELEASE ledger events.';
      }
      return null;
    case InventoryReservationStatus.SHIPPED:
      if (!events.reserve || !events.ship || events.release) {
        return 'SHIPPED reservation does not match expected RESERVE/SHIP ledger events.';
      }
      return null;
    default: {
      const exhaustive: never = status;
      return `Unsupported reservation status: ${String(exhaustive)}`;
    }
  }
}

import { randomUUID } from 'node:crypto';
import {
  InventoryLedgerReferenceType,
  InventoryLedgerType,
  type InventoryLedgerEntry,
} from './inventory-ledger';
import {
  InventoryReconciliationIssueCode,
  InventoryReconciliationStatus,
  reconcileInventorySnapshot,
  sortLedgerDeterministically,
} from './inventory-reconciliation';
import {
  InventoryReservationStatus,
  type InventoryReservation,
} from './inventory-reservation';

const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORDER_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORDER_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ORDER_C = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CHECKED_AT = new Date('2026-08-22T12:00:00.000Z');

function reservation(
  overrides: Partial<InventoryReservation> = {},
): InventoryReservation {
  const now = new Date('2026-08-22T10:00:00.000Z');
  return {
    id: randomUUID(),
    orderId: ORDER_A,
    productId: PRODUCT_ID,
    quantity: 3,
    status: InventoryReservationStatus.ACTIVE,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function ledgerRow(
  overrides: Partial<InventoryLedgerEntry> & {
    onHandAfter: number;
    reservedAfter: number;
  },
): InventoryLedgerEntry {
  const createdAt = overrides.createdAt ?? new Date('2026-08-22T10:00:00.000Z');
  return {
    id: randomUUID(),
    productId: PRODUCT_ID,
    type: InventoryLedgerType.RECEIVE,
    quantity: 10,
    onHandDelta: 10,
    reservedDelta: 0,
    referenceType: InventoryLedgerReferenceType.RECEIVE,
    referenceId: randomUUID(),
    reason: null,
    actorType: 'SYSTEM',
    actorId: null,
    correlationId: null,
    createdAt,
    ...overrides,
  };
}

function reconcile(input: {
  onHand?: number;
  reserved?: number;
  reservations?: InventoryReservation[];
  ledger?: InventoryLedgerEntry[];
}): ReturnType<typeof reconcileInventorySnapshot> {
  return reconcileInventorySnapshot({
    productId: PRODUCT_ID,
    onHand: input.onHand ?? 0,
    reserved: input.reserved ?? 0,
    reservations: input.reservations ?? [],
    ledger: input.ledger ?? [],
    checkedAt: CHECKED_AT,
  });
}

describe('reconcileInventorySnapshot', () => {
  it('reports fully consistent 0/0 baseline', () => {
    const result = reconcile({});
    expect(result.status).toBe(InventoryReconciliationStatus.CONSISTENT);
    expect(result.issues).toHaveLength(0);
    expect(result.current).toEqual({
      onHand: 0,
      reserved: 0,
      available: 0,
    });
    expect(result.expected).toEqual({
      reservedFromReservations: 0,
      onHandFromLedger: null,
      reservedFromLedger: null,
    });
  });

  it('accepts when current reserved equals ACTIVE reservation sum', () => {
    const result = reconcile({
      onHand: 20,
      reserved: 8,
      reservations: [
        reservation({ orderId: ORDER_A, quantity: 3 }),
        reservation({ orderId: ORDER_B, quantity: 5 }),
        reservation({
          orderId: ORDER_C,
          quantity: 2,
          status: InventoryReservationStatus.RELEASED,
        }),
      ],
      ledger: [
        ledgerRow({
          type: InventoryLedgerType.RECEIVE,
          quantity: 20,
          onHandDelta: 20,
          reservedDelta: 0,
          onHandAfter: 20,
          reservedAfter: 0,
        }),
        ledgerRow({
          type: InventoryLedgerType.RESERVE,
          quantity: 3,
          onHandDelta: 0,
          reservedDelta: 3,
          onHandAfter: 20,
          reservedAfter: 3,
          referenceType: InventoryLedgerReferenceType.ORDER,
          referenceId: ORDER_A,
          createdAt: new Date('2026-08-22T10:01:00.000Z'),
        }),
        ledgerRow({
          type: InventoryLedgerType.RESERVE,
          quantity: 5,
          onHandDelta: 0,
          reservedDelta: 5,
          onHandAfter: 20,
          reservedAfter: 8,
          referenceType: InventoryLedgerReferenceType.ORDER,
          referenceId: ORDER_B,
          createdAt: new Date('2026-08-22T10:02:00.000Z'),
        }),
        ledgerRow({
          type: InventoryLedgerType.RESERVE,
          quantity: 2,
          onHandDelta: 0,
          reservedDelta: 2,
          onHandAfter: 20,
          reservedAfter: 10,
          referenceType: InventoryLedgerReferenceType.ORDER,
          referenceId: ORDER_C,
          createdAt: new Date('2026-08-22T10:03:00.000Z'),
        }),
        ledgerRow({
          type: InventoryLedgerType.RELEASE,
          quantity: 2,
          onHandDelta: 0,
          reservedDelta: -2,
          onHandAfter: 20,
          reservedAfter: 8,
          referenceType: InventoryLedgerReferenceType.ORDER,
          referenceId: ORDER_C,
          createdAt: new Date('2026-08-22T10:04:00.000Z'),
        }),
      ],
    });
    expect(result.status).toBe(InventoryReconciliationStatus.CONSISTENT);
  });

  it('reports reserved mismatch', () => {
    const result = reconcile({
      onHand: 20,
      reserved: 10,
      reservations: [
        reservation({ orderId: ORDER_A, quantity: 3 }),
        reservation({ orderId: ORDER_B, quantity: 5 }),
      ],
      ledger: [
        ledgerRow({
          quantity: 20,
          onHandDelta: 20,
          onHandAfter: 20,
          reservedAfter: 0,
        }),
      ],
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: InventoryReconciliationIssueCode.RESERVED_MISMATCH,
        }),
      ]),
    );
  });

  it('reconstructs ledger delta totals and detects tail mismatch', () => {
    const result = reconcile({
      onHand: 15,
      reserved: 0,
      ledger: [
        ledgerRow({
          quantity: 10,
          onHandDelta: 10,
          onHandAfter: 10,
          reservedAfter: 0,
        }),
        ledgerRow({
          type: InventoryLedgerType.ADJUST,
          quantity: 5,
          onHandDelta: 5,
          onHandAfter: 15,
          reservedAfter: 0,
          referenceType: InventoryLedgerReferenceType.ADJUSTMENT,
          createdAt: new Date('2026-08-22T10:01:00.000Z'),
        }),
      ],
    });
    expect(result.status).toBe(InventoryReconciliationStatus.CONSISTENT);
    expect(result.expected.onHandFromLedger).toBe(15);
  });

  it('detects latest after-balance mismatch with current row', () => {
    const result = reconcile({
      onHand: 99,
      reserved: 0,
      ledger: [
        ledgerRow({
          quantity: 10,
          onHandDelta: 10,
          onHandAfter: 10,
          reservedAfter: 0,
        }),
      ],
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: InventoryReconciliationIssueCode.LEDGER_BALANCE_MISMATCH,
        }),
      ]),
    );
  });

  it('detects broken ledger sequence', () => {
    const result = reconcile({
      onHand: 12,
      reserved: 0,
      ledger: [
        ledgerRow({
          quantity: 10,
          onHandDelta: 10,
          onHandAfter: 10,
          reservedAfter: 0,
        }),
        ledgerRow({
          type: InventoryLedgerType.ADJUST,
          quantity: 2,
          onHandDelta: 2,
          onHandAfter: 99,
          reservedAfter: 0,
          referenceType: InventoryLedgerReferenceType.ADJUSTMENT,
          createdAt: new Date('2026-08-22T10:01:00.000Z'),
        }),
      ],
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: InventoryReconciliationIssueCode.INVALID_LEDGER_SEQUENCE,
        }),
      ]),
    );
  });

  it('validates ACTIVE reservation lifecycle events', () => {
    const result = reconcile({
      onHand: 10,
      reserved: 3,
      reservations: [reservation({ quantity: 3 })],
      ledger: [
        ledgerRow({
          quantity: 10,
          onHandDelta: 10,
          onHandAfter: 10,
          reservedAfter: 0,
        }),
      ],
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: InventoryReconciliationIssueCode.RESERVATION_LEDGER_MISMATCH,
        }),
        expect.objectContaining({
          code: InventoryReconciliationIssueCode.LEDGER_BALANCE_MISMATCH,
        }),
      ]),
    );
  });

  it('validates RELEASED reservation lifecycle events', () => {
    const result = reconcile({
      onHand: 10,
      reserved: 0,
      reservations: [
        reservation({
          quantity: 3,
          status: InventoryReservationStatus.RELEASED,
        }),
      ],
      ledger: [
        ledgerRow({
          quantity: 10,
          onHandDelta: 10,
          onHandAfter: 10,
          reservedAfter: 0,
        }),
        ledgerRow({
          type: InventoryLedgerType.RESERVE,
          quantity: 3,
          onHandDelta: 0,
          reservedDelta: 3,
          onHandAfter: 10,
          reservedAfter: 3,
          referenceType: InventoryLedgerReferenceType.ORDER,
          referenceId: ORDER_A,
          createdAt: new Date('2026-08-22T10:01:00.000Z'),
        }),
      ],
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: InventoryReconciliationIssueCode.RESERVATION_LEDGER_MISMATCH,
        }),
      ]),
    );
  });

  it('validates SHIPPED reservation lifecycle events', () => {
    const result = reconcile({
      onHand: 7,
      reserved: 0,
      reservations: [
        reservation({
          quantity: 3,
          status: InventoryReservationStatus.SHIPPED,
        }),
      ],
      ledger: [
        ledgerRow({
          quantity: 10,
          onHandDelta: 10,
          onHandAfter: 10,
          reservedAfter: 0,
        }),
        ledgerRow({
          type: InventoryLedgerType.RESERVE,
          quantity: 3,
          onHandDelta: 0,
          reservedDelta: 3,
          onHandAfter: 10,
          reservedAfter: 3,
          referenceType: InventoryLedgerReferenceType.ORDER,
          referenceId: ORDER_A,
          createdAt: new Date('2026-08-22T10:01:00.000Z'),
        }),
        ledgerRow({
          type: InventoryLedgerType.SHIP,
          quantity: 3,
          onHandDelta: -3,
          reservedDelta: -3,
          onHandAfter: 7,
          reservedAfter: 0,
          referenceType: InventoryLedgerReferenceType.ORDER,
          referenceId: ORDER_A,
          createdAt: new Date('2026-08-22T10:02:00.000Z'),
        }),
      ],
    });
    expect(result.status).toBe(InventoryReconciliationStatus.CONSISTENT);
  });

  it('detects conflicting RELEASE and SHIP lifecycle events', () => {
    const result = reconcile({
      onHand: 10,
      reserved: 0,
      reservations: [
        reservation({
          quantity: 3,
          status: InventoryReservationStatus.RELEASED,
        }),
      ],
      ledger: [
        ledgerRow({
          quantity: 10,
          onHandDelta: 10,
          onHandAfter: 10,
          reservedAfter: 0,
        }),
        ledgerRow({
          type: InventoryLedgerType.RESERVE,
          quantity: 3,
          onHandDelta: 0,
          reservedDelta: 3,
          onHandAfter: 10,
          reservedAfter: 3,
          referenceType: InventoryLedgerReferenceType.ORDER,
          referenceId: ORDER_A,
          createdAt: new Date('2026-08-22T10:01:00.000Z'),
        }),
        ledgerRow({
          type: InventoryLedgerType.RELEASE,
          quantity: 3,
          onHandDelta: 0,
          reservedDelta: -3,
          onHandAfter: 10,
          reservedAfter: 0,
          referenceType: InventoryLedgerReferenceType.ORDER,
          referenceId: ORDER_A,
          createdAt: new Date('2026-08-22T10:02:00.000Z'),
        }),
        ledgerRow({
          type: InventoryLedgerType.SHIP,
          quantity: 3,
          onHandDelta: -3,
          reservedDelta: -3,
          onHandAfter: 7,
          reservedAfter: 0,
          referenceType: InventoryLedgerReferenceType.ORDER,
          referenceId: ORDER_A,
          createdAt: new Date('2026-08-22T10:03:00.000Z'),
        }),
      ],
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: InventoryReconciliationIssueCode.ORPHAN_RESERVATION,
        }),
      ]),
    );
  });

  it('does not require reservations for RECEIVE/ADJUST ledger events', () => {
    const result = reconcile({
      onHand: 14,
      reserved: 0,
      ledger: [
        ledgerRow({
          quantity: 10,
          onHandDelta: 10,
          onHandAfter: 10,
          reservedAfter: 0,
        }),
        ledgerRow({
          type: InventoryLedgerType.ADJUST,
          quantity: 4,
          onHandDelta: 4,
          onHandAfter: 14,
          reservedAfter: 0,
          referenceType: InventoryLedgerReferenceType.ADJUSTMENT,
          createdAt: new Date('2026-08-22T10:01:00.000Z'),
        }),
      ],
    });
    expect(result.status).toBe(InventoryReconciliationStatus.CONSISTENT);
  });

  it('aggregates multiple issue types', () => {
    const result = reconcile({
      onHand: -1,
      reserved: 5,
      reservations: [reservation({ quantity: 1 })],
      ledger: [],
    });
    expect(result.status).toBe(InventoryReconciliationStatus.INCONSISTENT);
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('reports balance invariant violations', () => {
    const result = reconcile({
      onHand: 5,
      reserved: 8,
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: InventoryReconciliationIssueCode.BALANCE_INVARIANT_VIOLATION,
        }),
      ]),
    );
  });
});

describe('sortLedgerDeterministically', () => {
  it('uses id as tie-breaker when createdAt matches', () => {
    const at = new Date('2026-08-22T10:00:00.000Z');
    const lowId = ledgerRow({
      id: '00000000-0000-4000-8000-000000000001',
      onHandAfter: 1,
      reservedAfter: 0,
      createdAt: at,
    });
    const highId = ledgerRow({
      id: '00000000-0000-4000-8000-000000000002',
      onHandAfter: 2,
      reservedAfter: 0,
      createdAt: at,
    });
    const sorted = sortLedgerDeterministically([highId, lowId]);
    expect(sorted.map((row) => row.id)).toEqual([lowId.id, highId.id]);
  });
});

import { InventoryInvalidAdjustmentError } from './inventory-errors';
import { InventoryInvalidQuantityError } from './inventory-errors';
import {
  InventoryLedgerActorType,
  InventoryLedgerType,
  assertLedgerActor,
  assertLedgerDeltasMatchType,
  assertRequiredReason,
  expectedDeltasForType,
  normalizeLedgerReason,
} from './inventory-ledger';

describe('Inventory ledger rules', () => {
  it('maps event types to signed deltas without negative quantity', () => {
    expect(expectedDeltasForType(InventoryLedgerType.RESERVE, 3)).toEqual({
      onHandDelta: 0,
      reservedDelta: 3,
    });
    expect(expectedDeltasForType(InventoryLedgerType.RELEASE, 3)).toEqual({
      onHandDelta: 0,
      reservedDelta: -3,
    });
    expect(expectedDeltasForType(InventoryLedgerType.SHIP, 3)).toEqual({
      onHandDelta: -3,
      reservedDelta: -3,
    });
    expect(expectedDeltasForType(InventoryLedgerType.RECEIVE, 5)).toEqual({
      onHandDelta: 5,
      reservedDelta: 0,
    });
    expect(expectedDeltasForType(InventoryLedgerType.ADJUST, 6, -6)).toEqual({
      onHandDelta: -6,
      reservedDelta: 0,
    });
  });

  it('rejects ledger after-balances that violate invariants', () => {
    expect(() =>
      assertLedgerDeltasMatchType({
        type: InventoryLedgerType.RESERVE,
        quantity: 1,
        onHandDelta: 0,
        reservedDelta: 1,
        onHandAfter: 1,
        reservedAfter: 2,
      }),
    ).toThrow(InventoryInvalidQuantityError);
  });

  it('requires a reason for ADJUST and WRITE_OFF only', () => {
    expect(() =>
      assertRequiredReason(InventoryLedgerType.ADJUST, null),
    ).toThrow(InventoryInvalidAdjustmentError);
    expect(() =>
      assertRequiredReason(InventoryLedgerType.WRITE_OFF, null),
    ).toThrow(InventoryInvalidAdjustmentError);
    expect(() =>
      assertRequiredReason(InventoryLedgerType.RESERVE, null),
    ).not.toThrow();
  });

  it('trims reasons and enforces SYSTEM actor nullability', () => {
    expect(normalizeLedgerReason('  counted short  ')).toBe('counted short');
    expect(normalizeLedgerReason('   ')).toBeNull();
    expect(
      assertLedgerActor({ type: InventoryLedgerActorType.SYSTEM, id: null }),
    ).toEqual({ type: InventoryLedgerActorType.SYSTEM, id: null });
    expect(() =>
      assertLedgerActor({
        type: InventoryLedgerActorType.SYSTEM,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    ).toThrow(InventoryInvalidAdjustmentError);
    expect(() =>
      assertLedgerActor({ type: InventoryLedgerActorType.ADMIN, id: null }),
    ).toThrow(InventoryInvalidAdjustmentError);
  });
});

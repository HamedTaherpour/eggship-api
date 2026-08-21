import { InventoryInvalidQuantityError } from './inventory-errors';
import {
  INVENTORY_INT4_MAX,
  assertAdjustmentDelta,
  assertInventoryUuid,
  assertPositiveQuantity,
  deriveAvailable,
} from './inventory-quantity';
import { toInventoryBalance } from './inventory-balance';

describe('Inventory quantities', () => {
  it('derives available as onHand minus reserved and never persists it', () => {
    expect(deriveAvailable(10, 3)).toBe(7);
    expect(deriveAvailable(0, 0)).toBe(0);

    const now = new Date();
    const balance = toInventoryBalance({
      productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      onHand: 10,
      reserved: 4,
      createdAt: now,
      updatedAt: now,
    });
    expect(balance.available).toBe(6);
    expect(balance).not.toHaveProperty('version');
  });

  it('accepts whole-unit quantities inside int4 bounds', () => {
    expect(assertPositiveQuantity(1)).toBe(1);
    expect(assertPositiveQuantity(INVENTORY_INT4_MAX)).toBe(INVENTORY_INT4_MAX);
  });

  it('rejects zero, negative, non-integer, and overflowing quantities', () => {
    expect(() => assertPositiveQuantity(0)).toThrow(
      InventoryInvalidQuantityError,
    );
    expect(() => assertPositiveQuantity(-1)).toThrow(
      InventoryInvalidQuantityError,
    );
    expect(() => assertPositiveQuantity(1.5)).toThrow(
      InventoryInvalidQuantityError,
    );
    expect(() => assertPositiveQuantity(INVENTORY_INT4_MAX + 1)).toThrow(
      InventoryInvalidQuantityError,
    );
  });

  it('rejects zero adjustment deltas and accepts signed int4 values', () => {
    expect(assertAdjustmentDelta(-3)).toBe(-3);
    expect(assertAdjustmentDelta(4)).toBe(4);
    expect(() => assertAdjustmentDelta(0)).toThrow(
      InventoryInvalidQuantityError,
    );
    expect(() => assertAdjustmentDelta(2.2)).toThrow(
      InventoryInvalidQuantityError,
    );
  });

  it('normalizes UUIDs and rejects non-UUID identifiers', () => {
    expect(
      assertInventoryUuid('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', 'productId'),
    ).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(() => assertInventoryUuid('not-a-uuid', 'productId')).toThrow(
      InventoryInvalidQuantityError,
    );
  });
});

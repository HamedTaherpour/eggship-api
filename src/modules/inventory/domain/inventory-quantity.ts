import { InventoryInvalidQuantityError } from './inventory-errors';

/**
 * Whole sellable units. Matches PostgreSQL `integer` / Prisma `Int` (int4).
 * Never use floating point for stock.
 */
export const INVENTORY_QUANTITY_MIN = 1;
export const INVENTORY_INT4_MAX = 2_147_483_647;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isInventoryUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function assertInventoryUuid(value: string, field: string): string {
  if (!isInventoryUuid(value)) {
    throw new InventoryInvalidQuantityError(`${field} must be a UUID.`);
  }
  return value.toLowerCase();
}

export function assertPositiveQuantity(
  raw: unknown,
  field = 'quantity',
): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new InventoryInvalidQuantityError(
      `${field} must be a whole number of sellable units.`,
    );
  }
  if (raw < INVENTORY_QUANTITY_MIN || raw > INVENTORY_INT4_MAX) {
    throw new InventoryInvalidQuantityError(
      `${field} must be between ${INVENTORY_QUANTITY_MIN} and ${INVENTORY_INT4_MAX}.`,
    );
  }
  return raw;
}

/**
 * Signed on-hand delta for ADJUST. Zero is rejected; overflow is rejected.
 */
export function assertAdjustmentDelta(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new InventoryInvalidQuantityError(
      'Adjustment delta must be a whole number of sellable units.',
    );
  }
  if (raw === 0) {
    throw new InventoryInvalidQuantityError(
      'Adjustment delta must be a non-zero whole number.',
    );
  }
  if (raw < -INVENTORY_INT4_MAX || raw > INVENTORY_INT4_MAX) {
    throw new InventoryInvalidQuantityError(
      `Adjustment delta must be between ${-INVENTORY_INT4_MAX} and ${INVENTORY_INT4_MAX}.`,
    );
  }
  return raw;
}

export function deriveAvailable(onHand: number, reserved: number): number {
  return onHand - reserved;
}

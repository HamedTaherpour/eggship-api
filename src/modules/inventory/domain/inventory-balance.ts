import { deriveAvailable } from './inventory-quantity';

/**
 * Persistence-neutral current balance. `available` is always derived.
 */
export interface InventoryBalance {
  productId: string;
  onHand: number;
  reserved: number;
  available: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toInventoryBalance(row: {
  productId: string;
  onHand: number;
  reserved: number;
  createdAt: Date;
  updatedAt: Date;
}): InventoryBalance {
  return {
    productId: row.productId,
    onHand: row.onHand,
    reserved: row.reserved,
    available: deriveAvailable(row.onHand, row.reserved),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

import { deriveAvailable } from './inventory-quantity';
import type { InventoryLedgerType } from './inventory-ledger';
import type { InventoryReservationStatus } from './inventory-reservation';

/** Admin inventory list row (one Product/Inventory pair). */
export interface InventoryListRecord {
  productId: string;
  productName: string;
  isActive: boolean;
  onHand: number;
  reserved: number;
  available: number;
  updatedAt: Date;
}

export type InventoryListSortField =
  'productName' | 'onHand' | 'reserved' | 'available' | 'updatedAt';

export interface InventoryListQuery {
  page: number;
  pageSize: number;
  search?: string;
  sortBy: InventoryListSortField;
  sortOrder: 'asc' | 'desc';
  isActive?: boolean;
}

export interface InventoryLedgerListQuery {
  productId: string;
  page: number;
  pageSize: number;
  type?: InventoryLedgerType;
  createdFrom?: Date;
  createdTo?: Date;
}

export interface InventoryReservationListQuery {
  productId: string;
  page: number;
  pageSize: number;
  status?: InventoryReservationStatus;
}

export function toInventoryListRecord(row: {
  productId: string;
  productName: string;
  isActive: boolean;
  onHand: number;
  reserved: number;
  updatedAt: Date;
}): InventoryListRecord {
  return {
    productId: row.productId,
    productName: row.productName,
    isActive: row.isActive,
    onHand: row.onHand,
    reserved: row.reserved,
    available: deriveAvailable(row.onHand, row.reserved),
    updatedAt: row.updatedAt,
  };
}

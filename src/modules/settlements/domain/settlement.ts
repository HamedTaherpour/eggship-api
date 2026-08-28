import type { OrderStatus } from '../../orders/domain/order-status';

export const SettlementStatus = {
  OPEN: 'OPEN',
  SETTLED: 'SETTLED',
} as const;

export type SettlementStatus =
  (typeof SettlementStatus)[keyof typeof SettlementStatus];

export interface SettlementRecord {
  id: string;
  orderId: string;
  orderStatus: OrderStatus;
  orderTotal: bigint;
  status: SettlementStatus;
  dueAt: Date;
  overdue: boolean;
  settledAt: Date | null;
  settledByAdminId: string | null;
  receiptMediaId: string | null;
  receiptAttachedAt: Date | null;
  receiptAttachedByAdminId: string | null;
  createdByAdminId: string;
  createdAt: Date;
  updatedAt: Date;
}

export type SettlementSortField = 'dueAt' | 'createdAt' | 'settledAt';

export interface SettlementListQuery {
  page: number;
  pageSize: number;
  status?: SettlementStatus;
  overdue?: boolean;
  dueFrom?: Date;
  dueTo?: Date;
  orderId?: string;
  sortBy: SettlementSortField;
  sortOrder: 'asc' | 'desc';
  now: Date;
}

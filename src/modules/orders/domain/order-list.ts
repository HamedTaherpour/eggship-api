import type { PageRequest, SortOrder } from '../../../common/list';
import type { OrderStatus } from './order-status';

export const CUSTOMER_ORDER_SORT_FIELDS = [
  'createdAt',
  'total',
  'status',
] as const;

export type CustomerOrderSortField =
  (typeof CUSTOMER_ORDER_SORT_FIELDS)[number];

/** Owner-scoped list row — no lines; detail uses `OrderRecord`. */
export interface OrderListRecord {
  id: string;
  status: OrderStatus;
  regionId: string;
  regionName: string;
  total: bigint;
  createdAt: Date;
}

export interface OrderListQuery extends PageRequest {
  sortBy: CustomerOrderSortField;
  sortOrder: SortOrder;
  status?: OrderStatus;
  createdFrom?: Date;
  createdTo?: Date;
}

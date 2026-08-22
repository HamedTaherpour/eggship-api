/**
 * Discount domain types (persistence-independent, PRC-02).
 */

export const DiscountType = {
  PERCENT: 'PERCENT',
  FIXED: 'FIXED',
} as const;

export type DiscountType = (typeof DiscountType)[keyof typeof DiscountType];

export const DiscountTarget = {
  ORDER: 'ORDER',
  PRODUCT: 'PRODUCT',
  CATEGORY: 'CATEGORY',
} as const;

export type DiscountTarget =
  (typeof DiscountTarget)[keyof typeof DiscountTarget];

export interface DiscountRecord {
  id: string;
  name: string;
  type: DiscountType;
  target: DiscountTarget;
  percentValue: number | null;
  fixedAmount: number | null;
  productId: string | null;
  categoryId: string | null;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  precedence: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDiscountInput {
  name: string;
  type: DiscountType;
  target: DiscountTarget;
  percentValue?: number | null;
  fixedAmount?: number | null;
  productId?: string | null;
  categoryId?: string | null;
  isActive?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
  precedence?: number;
}

export interface UpdateDiscountInput {
  name?: string;
  type?: DiscountType;
  target?: DiscountTarget;
  percentValue?: number | null;
  fixedAmount?: number | null;
  productId?: string | null;
  categoryId?: string | null;
  isActive?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
  precedence?: number;
}

export type DiscountSortField =
  'name' | 'createdAt' | 'updatedAt' | 'precedence';

export interface DiscountListQuery {
  page: number;
  pageSize: number;
  search?: string;
  sortBy: DiscountSortField;
  sortOrder: 'asc' | 'desc';
  isActive?: boolean;
  type?: DiscountType;
  target?: DiscountTarget;
}

/** Normalized discount payload ready for persistence validation. */
export interface DiscountPayload {
  name: string;
  type: DiscountType;
  target: DiscountTarget;
  percentValue: number | null;
  fixedAmount: number | null;
  productId: string | null;
  categoryId: string | null;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  precedence: number;
}

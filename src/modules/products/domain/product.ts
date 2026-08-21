/**
 * Product domain types (persistence-independent).
 * Current price is integer Toman; Inventory quantities are not Product fields.
 */

export interface ProductRecord {
  id: string;
  name: string;
  /** Current selling price in integer Toman. */
  price: number;
  categoryId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProductInput {
  name: string;
  price: number;
  categoryId: string;
  isActive?: boolean;
}

export interface UpdateProductInput {
  name?: string;
  price?: number;
  categoryId?: string;
  isActive?: boolean;
}

export type ProductSortField = 'name' | 'price' | 'createdAt' | 'updatedAt';

export interface ProductListQuery {
  page: number;
  pageSize: number;
  search?: string;
  sortBy: ProductSortField;
  sortOrder: 'asc' | 'desc';
  categoryId?: string;
  isActive?: boolean;
  /**
   * When true, only products whose Category is also active.
   * Used by public storefront lists/detail.
   */
  requireActiveCategory?: boolean;
}

/**
 * Product domain types (persistence-independent).
 * Current price is integer Toman; Inventory quantities are not Product fields.
 */
import type { MediaPresentation } from '../../media/domain/media-presentation';

export interface ProductRecord {
  id: string;
  name: string;
  /** Current selling price in integer Toman. */
  price: number;
  categoryId: string;
  imageMediaId?: string | null;
  image?: MediaPresentation | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProductInput {
  name: string;
  price: number;
  categoryId: string;
  isActive?: boolean;
  imageMediaId?: string | null;
}

export interface UpdateProductInput {
  name?: string;
  categoryId?: string;
  isActive?: boolean;
  imageMediaId?: string | null;
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

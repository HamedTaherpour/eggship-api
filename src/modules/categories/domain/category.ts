/**
 * Category domain types (persistence-independent).
 */

export interface CategoryRecord {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCategoryInput {
  name: string;
  isActive?: boolean;
}

export interface UpdateCategoryInput {
  name?: string;
  isActive?: boolean;
}

export type CategorySortField = 'name' | 'createdAt' | 'updatedAt';

export interface CategoryListQuery {
  page: number;
  pageSize: number;
  search?: string;
  sortBy: CategorySortField;
  sortOrder: 'asc' | 'desc';
  isActive?: boolean;
}

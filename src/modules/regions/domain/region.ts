/**
 * Region domain types (persistence-independent).
 */

export interface RegionRecord {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRegionInput {
  name: string;
  isActive?: boolean;
}

export interface UpdateRegionInput {
  name?: string;
  isActive?: boolean;
}

export type RegionSortField = 'name' | 'createdAt' | 'updatedAt';

export interface RegionListQuery {
  page: number;
  pageSize: number;
  search?: string;
  sortBy: RegionSortField;
  sortOrder: 'asc' | 'desc';
  isActive?: boolean;
}

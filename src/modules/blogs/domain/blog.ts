/**
 * Blog domain types (persistence-independent).
 * Public APIs expose published posts only. Media attachment is MED-01.
 */

export interface BlogRecord {
  id: string;
  slug: string;
  title: string;
  body: string;
  isPublished: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBlogInput {
  slug: string;
  title: string;
  body: string;
  isPublished?: boolean;
  publishedAt?: Date | null;
}

export type BlogSortField = 'publishedAt' | 'title' | 'createdAt';

export interface BlogListQuery {
  page: number;
  pageSize: number;
  search?: string;
  sortBy: BlogSortField;
  sortOrder: 'asc' | 'desc';
}

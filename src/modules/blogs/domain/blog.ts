/**
 * Blog domain types (persistence-independent).
 * Public APIs expose published posts only. Media attachment is MED-01.
 */
import type { MediaPresentation } from '../../media/domain/media-presentation';

export interface BlogRecord {
  id: string;
  slug: string;
  title: string;
  body: string;
  coverMediaId?: string | null;
  cover?: MediaPresentation | null;
  inlineMedia?: MediaPresentation[];
  inlineMediaIds?: string[];
  excerpt?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  author?: BlogAuthorRecord | null;
  categories?: BlogTaxonomyRecord[];
  tags?: BlogTaxonomyRecord[];
  isPublished: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BlogAuthorRecord {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  avatarMediaId: string | null;
  avatar?: MediaPresentation | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
export interface BlogTaxonomyRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive?: boolean;
}

export interface CreateBlogInput {
  slug: string;
  title: string;
  body: string;
  isPublished?: boolean;
  publishedAt?: Date | null;
  excerpt?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  authorId?: string | null;
  coverMediaId?: string | null;
  categoryIds?: string[];
  tagIds?: string[];
}

/** Explicit PATCH allowlist for Admin edits (CNT-02). */
export interface UpdateBlogInput {
  slug?: string;
  title?: string;
  body?: string;
  excerpt?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  authorId?: string | null;
  coverMediaId?: string | null;
  categoryIds?: string[];
  tagIds?: string[];
}

export type BlogSortField = 'publishedAt' | 'title' | 'createdAt';

export interface BlogListQuery {
  page: number;
  pageSize: number;
  search?: string;
  sortBy: BlogSortField;
  sortOrder: 'asc' | 'desc';
  /** Admin-only filter. Public list must not accept this. */
  isPublished?: boolean;
}

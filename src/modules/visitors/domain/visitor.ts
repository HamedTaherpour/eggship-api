export interface VisitorRecord {
  id: string;
  name: string;
  referralCode: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminVisitorRecord extends VisitorRecord {
  attributionCount: number;
}

export interface AdminReferralEvidenceRecord {
  attributionId: string;
  visitorId: string;
  customerId: string;
  customerPhone: string;
  customerIsActive: boolean;
  source: 'VISITOR';
  referralCode: string;
  attributedAt: Date;
}

export interface AdminVisitorListQuery {
  page: number;
  pageSize: number;
  search?: string;
  sortBy: AdminVisitorSortField;
  sortOrder: 'asc' | 'desc';
  isActive?: boolean;
  hasAttributions?: boolean;
}

export type AdminVisitorSortField =
  'createdAt' | 'updatedAt' | 'name' | 'referralCode';

export interface AdminReferralEvidenceListQuery {
  visitorId: string;
  page: number;
  pageSize: number;
  search?: string;
  sortBy: AdminReferralEvidenceSortField;
  sortOrder: 'asc' | 'desc';
}

export type AdminReferralEvidenceSortField = 'attributedAt' | 'referralCode';

export interface ReferralAttributionRecord {
  id: string;
  userId: string;
  source: 'VISITOR';
  visitorId: string;
  referralCode: string;
  attributedAt: Date;
}

export interface CreateVisitorInput {
  name: string;
  referralCode?: string;
  isActive?: boolean;
}

/**
 * Admin customer/store read model (ADM-02).
 *
 * The storefront subject is the `User` record itself (authentication.md):
 * one record is both the login identity and the customer/store account root.
 * No separate `Store` entity is introduced here.
 *
 * Referral attribution is read-only historical evidence from REF-02. Admin
 * cannot create, edit, or reassign it; this model only surfaces the existing
 * immutable row and its owning Visitor display fields for back-office review.
 */
export interface AdminCustomerReferralView {
  visitorId: string;
  visitorName: string;
  visitorIsActive: boolean;
  referralCode: string;
  attributedAt: Date;
}

export interface AdminCustomerRecord {
  id: string;
  phone: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  referral: AdminCustomerReferralView | null;
}

export interface AdminCustomerListQuery {
  page: number;
  pageSize: number;
  search?: string;
  sortBy: AdminCustomerSortField;
  sortOrder: 'asc' | 'desc';
  isActive?: boolean;
  hasReferral?: boolean;
}

export type AdminCustomerSortField = 'createdAt' | 'updatedAt';

export interface VisitorRecord {
  id: string;
  name: string;
  referralCode: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

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

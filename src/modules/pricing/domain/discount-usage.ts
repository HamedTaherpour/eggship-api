/**
 * DiscountCustomerUsage aggregate + append-only DiscountUsageRecord (DLU-02).
 */

export const DiscountUsageRecordKind = {
  CONSUME: 'CONSUME',
  RELEASE: 'RELEASE',
} as const;

export type DiscountUsageRecordKind =
  (typeof DiscountUsageRecordKind)[keyof typeof DiscountUsageRecordKind];

export interface DiscountCustomerUsageRecord {
  discountId: string;
  userId: string;
  consumedQuantity: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DiscountUsageRecord {
  id: string;
  discountId: string;
  userId: string;
  orderId: string;
  kind: DiscountUsageRecordKind;
  quantity: number;
  createdAt: Date;
}

/** Planned CONSUME row derived from a priced Order snapshot. */
export interface DiscountUsageConsumeIntent {
  discountId: string;
  quantity: number;
}

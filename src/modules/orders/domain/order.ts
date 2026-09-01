import type { AppliedDiscountSnapshot } from '../../pricing/domain/discount-calculation';
import type { OrderStatus } from './order-status';

export type { AppliedDiscountSnapshot };

export interface OrderLineRecord {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  /** Units that received the LINE discount (0…quantity). DLU-02. */
  discountedQuantity: number;
  /** unitPrice × quantity (ORD-01 gross; renamed from lineTotal in ORD-03). */
  grossLineTotal: bigint;
  lineDiscountAmount: bigint;
  finalLineTotal: bigint;
  appliedLineDiscount: AppliedDiscountSnapshot | null;
  createdAt: Date;
}

export interface OrderRecord {
  id: string;
  userId: string;
  status: OrderStatus;
  customerPhone: string;
  regionId: string;
  regionName: string;
  grossSubtotal: bigint;
  lineDiscountTotal: bigint;
  subtotalAfterLineDiscounts: bigint;
  orderDiscountAmount: bigint;
  total: bigint;
  pricingEvaluatedAt: Date;
  /** Commerce policy revision at create (COM-03). Null only for pre-COM-03 rows. */
  commercePolicyRevision: number | null;
  appliedOrderDiscount: AppliedDiscountSnapshot | null;
  idempotencyKey: string | null;
  idempotencyPayloadHash: string | null;
  deliveryAt: Date | null;
  confirmedAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  /** Nullable lifecycle timestamp; optional for legacy in-memory test fixtures. */
  returnedAt?: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  lines: OrderLineRecord[];
}

/**
 * Trusted server-built line snapshot for persistence (ORD-03).
 * Built from PRC-05 output — never from client money/name/discount fields.
 */
export interface TrustedOrderLineSnapshot {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  discountedQuantity: number;
  grossLineTotal: bigint;
  lineDiscountAmount: bigint;
  finalLineTotal: bigint;
  appliedLineDiscount: AppliedDiscountSnapshot | null;
}

/**
 * Trusted server-built order create payload for the repository boundary.
 * Application service owns validation; repository re-checks money invariants.
 */
export interface TrustedCreateOrderInput {
  userId: string;
  customerPhone: string;
  regionId: string;
  regionName: string;
  idempotencyKey: string;
  idempotencyPayloadHash: string;
  pricingEvaluatedAt: Date;
  /** Positive CommerceSettings.revision observed for this create attempt. */
  commercePolicyRevision: number;
  grossSubtotal: bigint;
  lineDiscountTotal: bigint;
  subtotalAfterLineDiscounts: bigint;
  orderDiscountAmount: bigint;
  total: bigint;
  appliedOrderDiscount: AppliedDiscountSnapshot | null;
  lines: TrustedOrderLineSnapshot[];
}

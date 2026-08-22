import type { OrderStatus } from './order-status';

export interface OrderLineRecord {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: bigint;
  createdAt: Date;
}

export interface OrderRecord {
  id: string;
  userId: string;
  status: OrderStatus;
  customerPhone: string;
  regionId: string;
  regionName: string;
  subtotal: bigint;
  total: bigint;
  idempotencyKey: string | null;
  deliveryAt: Date | null;
  confirmedAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  lines: OrderLineRecord[];
}

/** Input for one order line at creation — snapshots supplied by caller (ORD-03 reads Product). */
export interface CreateOrderLineInput {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
}

/**
 * Persistence primitive for ORD-01 / future ORD-03 creation.
 * Money totals are computed server-side; lineTotal is never trusted from input.
 */
export interface CreateOrderInput {
  userId: string;
  customerPhone: string;
  regionId: string;
  regionName: string;
  lines: CreateOrderLineInput[];
  idempotencyKey?: string;
}

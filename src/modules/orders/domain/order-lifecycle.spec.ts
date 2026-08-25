import type { OrderRecord } from './order';
import { assertLifecycleTimestamps } from './order-lifecycle';
import { OrderStatus } from './order-status';

const NOW = new Date('2026-08-22T10:00:00.000Z');

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    status: OrderStatus.PENDING_REVIEW,
    customerPhone: '+989121234567',
    regionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    regionName: 'Tehran',
    grossSubtotal: 1000n,
    lineDiscountTotal: 0n,
    subtotalAfterLineDiscounts: 1000n,
    orderDiscountAmount: 0n,
    total: 1000n,
    pricingEvaluatedAt: NOW,
    commercePolicyRevision: 1,
    appliedOrderDiscount: null,
    idempotencyKey: null,
    idempotencyPayloadHash: null,
    deliveryAt: null,
    confirmedAt: null,
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    lines: [],
    ...overrides,
  };
}

describe('order lifecycle timestamps', () => {
  it('requires confirmedAt for CONFIRMED', () => {
    expect(() =>
      assertLifecycleTimestamps(order({ status: OrderStatus.CONFIRMED })),
    ).toThrow('confirmedAt');
    expect(() =>
      assertLifecycleTimestamps(
        order({ status: OrderStatus.CONFIRMED, confirmedAt: NOW }),
      ),
    ).not.toThrow();
  });

  it('requires confirmedAt and shippedAt for SHIPPED', () => {
    expect(() =>
      assertLifecycleTimestamps(
        order({ status: OrderStatus.SHIPPED, confirmedAt: NOW }),
      ),
    ).toThrow('shippedAt');
  });

  it('requires confirmedAt, shippedAt, and deliveredAt for DELIVERED', () => {
    expect(() =>
      assertLifecycleTimestamps(
        order({
          status: OrderStatus.DELIVERED,
          confirmedAt: NOW,
          shippedAt: NOW,
        }),
      ),
    ).toThrow('deliveredAt');
  });

  it('requires cancelledAt for CANCELLED and allows prior confirmedAt', () => {
    expect(() =>
      assertLifecycleTimestamps(order({ status: OrderStatus.CANCELLED })),
    ).toThrow('cancelledAt');
    expect(() =>
      assertLifecycleTimestamps(
        order({
          status: OrderStatus.CANCELLED,
          confirmedAt: NOW,
          cancelledAt: NOW,
        }),
      ),
    ).not.toThrow();
  });
});

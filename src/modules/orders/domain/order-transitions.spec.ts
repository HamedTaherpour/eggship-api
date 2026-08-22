import { OrderStatus } from './order-status';
import {
  canTransition,
  classifyZeroRowUpdate,
  ORDER_TRANSITIONS,
  ZeroRowClassification,
} from './order-transitions';

const ALL_STATUSES = Object.values(OrderStatus);

describe('order transition graph', () => {
  const allowed: Array<[OrderStatus, OrderStatus]> = [
    [OrderStatus.PENDING_REVIEW, OrderStatus.CONFIRMED],
    [OrderStatus.PENDING_REVIEW, OrderStatus.CANCELLED],
    [OrderStatus.CONFIRMED, OrderStatus.SHIPPED],
    [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
    [OrderStatus.SHIPPED, OrderStatus.DELIVERED],
  ];

  it.each(allowed)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it('rejects every pair that is not on the locked V1 graph', () => {
    const allowedKeys = new Set(allowed.map(([from, to]) => `${from}>${to}`));
    const rejected: Array<[OrderStatus, OrderStatus]> = [];
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (!allowedKeys.has(`${from}>${to}`)) {
          rejected.push([from, to]);
        }
      }
    }

    expect(rejected).toEqual(
      expect.arrayContaining([
        [OrderStatus.PENDING_REVIEW, OrderStatus.SHIPPED],
        [OrderStatus.PENDING_REVIEW, OrderStatus.DELIVERED],
        [OrderStatus.CONFIRMED, OrderStatus.DELIVERED],
        [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
        [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
        [OrderStatus.DELIVERED, OrderStatus.RETURNED],
        [OrderStatus.CANCELLED, OrderStatus.CONFIRMED],
        [OrderStatus.RETURNED, OrderStatus.DELIVERED],
        [OrderStatus.CONFIRMED, OrderStatus.PENDING_REVIEW],
        [OrderStatus.SHIPPED, OrderStatus.CONFIRMED],
        [OrderStatus.DELIVERED, OrderStatus.SHIPPED],
      ]),
    );

    for (const [from, to] of rejected) {
      expect(canTransition(from, to)).toBe(false);
    }
  });

  it('does not expose a RETURNED runtime edge from DELIVERED', () => {
    expect(ORDER_TRANSITIONS[OrderStatus.DELIVERED]).toEqual([]);
    expect(ORDER_TRANSITIONS[OrderStatus.RETURNED]).toEqual([]);
    expect(ORDER_TRANSITIONS[OrderStatus.CANCELLED]).toEqual([]);
  });

  it('classifies zero-row updates as missing, replay, or invalid', () => {
    expect(classifyZeroRowUpdate(null, OrderStatus.CONFIRMED)).toBe(
      ZeroRowClassification.MISSING,
    );
    expect(
      classifyZeroRowUpdate(OrderStatus.CONFIRMED, OrderStatus.CONFIRMED),
    ).toBe(ZeroRowClassification.REPLAY);
    expect(
      classifyZeroRowUpdate(OrderStatus.CANCELLED, OrderStatus.CONFIRMED),
    ).toBe(ZeroRowClassification.INVALID);
    expect(
      classifyZeroRowUpdate(OrderStatus.SHIPPED, OrderStatus.CANCELLED),
    ).toBe(ZeroRowClassification.INVALID);
  });
});

import { OrderStatus } from './order-status';
import {
  ADMIN_DISPATCH_ORDER_LIMIT,
  buildAdminDispatchBoard,
  compareDispatchOrders,
  type AdminDispatchOrderRecord,
} from './order-dispatch';

const REGION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REGION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T0 = new Date('2026-09-01T10:00:00.000Z');
const T1 = new Date('2026-09-02T10:00:00.000Z');

function row(
  overrides: Partial<AdminDispatchOrderRecord> &
    Pick<AdminDispatchOrderRecord, 'id' | 'status' | 'regionId' | 'regionName'>,
): AdminDispatchOrderRecord {
  return {
    customerPhone: '+989121234567',
    total: 1000n,
    lineCount: 1,
    deliveryAt: null,
    confirmedAt: T0,
    shippedAt: null,
    createdAt: T0,
    ...overrides,
  };
}

describe('order-dispatch domain', () => {
  it('orders by deliveryAt ASC with nulls last, then createdAt, then id', () => {
    const a = row({
      id: '11111111-1111-4111-8111-111111111111',
      status: OrderStatus.CONFIRMED,
      regionId: REGION_A,
      regionName: 'Alpha',
      deliveryAt: T1,
      createdAt: T0,
    });
    const b = row({
      id: '22222222-2222-4222-8222-222222222222',
      status: OrderStatus.CONFIRMED,
      regionId: REGION_A,
      regionName: 'Alpha',
      deliveryAt: T0,
      createdAt: T0,
    });
    const c = row({
      id: '33333333-3333-4333-8333-333333333333',
      status: OrderStatus.SHIPPED,
      regionId: REGION_A,
      regionName: 'Alpha',
      deliveryAt: null,
      createdAt: T0,
    });
    const d = row({
      id: '00000000-0000-4000-8000-000000000000',
      status: OrderStatus.CONFIRMED,
      regionId: REGION_A,
      regionName: 'Alpha',
      deliveryAt: T0,
      createdAt: T0,
    });

    const sorted = [a, b, c, d].sort(compareDispatchOrders);
    expect(sorted.map((item) => item.id)).toEqual([
      d.id, // same deliveryAt/createdAt as b, lower id
      b.id,
      a.id,
      c.id, // null deliveryAt last
    ]);
  });

  it('groups by region name/id and builds summary with truncation metadata', () => {
    const items = [
      row({
        id: '11111111-1111-4111-8111-111111111111',
        status: OrderStatus.SHIPPED,
        regionId: REGION_B,
        regionName: 'Beta',
        deliveryAt: T0,
      }),
      row({
        id: '22222222-2222-4222-8222-222222222222',
        status: OrderStatus.CONFIRMED,
        regionId: REGION_A,
        regionName: 'Alpha',
        deliveryAt: T1,
      }),
      row({
        id: '33333333-3333-4333-8333-333333333333',
        status: OrderStatus.CONFIRMED,
        regionId: REGION_A,
        regionName: 'Alpha',
        deliveryAt: T0,
      }),
    ];

    const board = buildAdminDispatchBoard(items, 150);
    expect(board.groups.map((g) => g.region.name)).toEqual(['Alpha', 'Beta']);
    expect(board.groups[0]!.orders.map((o) => o.id)).toEqual([
      '33333333-3333-4333-8333-333333333333',
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(board.summary).toEqual({
      ordersCount: 3,
      confirmedCount: 2,
      shippedCount: 1,
      regionCount: 2,
      limit: ADMIN_DISPATCH_ORDER_LIMIT,
      truncated: true,
      matchedCount: 150,
    });
  });
});

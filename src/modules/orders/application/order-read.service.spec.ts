import { OrderNotFoundError } from '../domain/order-errors';
import { OrderStatus } from '../domain/order-status';
import type { OrderRecord } from '../domain/order';
import type { OrderListRecord } from '../domain/order-list';
import { OrderReadService } from './order-read.service';
import type { OrderRepository } from '../infrastructure/order.repository';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '55555555-5555-4555-8555-555555555555';

function sampleListRecord(): OrderListRecord {
  return {
    id: ORDER_ID,
    status: OrderStatus.PENDING_REVIEW,
    regionId: '33333333-3333-4333-8333-333333333333',
    regionName: 'Tehran',
    total: 20_000n,
    createdAt: new Date('2026-08-22T10:00:00.000Z'),
  };
}

function sampleOrder(): OrderRecord {
  const now = new Date('2026-08-22T10:00:00.000Z');
  return {
    id: ORDER_ID,
    userId: OWNER_ID,
    status: OrderStatus.PENDING_REVIEW,
    customerPhone: '+989121234567',
    regionId: '33333333-3333-4333-8333-333333333333',
    regionName: 'Tehran',
    grossSubtotal: 20_000n,
    lineDiscountTotal: 0n,
    subtotalAfterLineDiscounts: 20_000n,
    orderDiscountAmount: 0n,
    total: 20_000n,
    pricingEvaluatedAt: now,
    commercePolicyRevision: 1,
    appliedOrderDiscount: null,
    idempotencyKey: '66666666-6666-4666-8666-666666666666',
    idempotencyPayloadHash: 'a'.repeat(64),
    deliveryAt: null,
    confirmedAt: null,
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: now,
    updatedAt: now,
    lines: [],
  };
}

describe('OrderReadService', () => {
  let listOwned: jest.MockedFunction<OrderRepository['listOwned']>;
  let findOwnedById: jest.MockedFunction<OrderRepository['findOwnedById']>;
  let listDispatch: jest.MockedFunction<OrderRepository['listDispatch']>;
  let service: OrderReadService;

  beforeEach(() => {
    listOwned = jest.fn();
    findOwnedById = jest.fn();
    listDispatch = jest.fn();
    service = new OrderReadService({
      listOwned,
      findOwnedById,
      listDispatch,
    } as unknown as OrderRepository);
  });

  it('lists owned orders with validated pagination and filters', async () => {
    listOwned.mockResolvedValue({ items: [sampleListRecord()], total: 1 });

    const page = await service.listOwned(OWNER_ID, {
      page: 1,
      pageSize: 20,
      status: OrderStatus.PENDING_REVIEW,
      createdFrom: '2026-08-01T00:00:00.000Z',
      createdTo: '2026-08-31T23:59:59.999Z',
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(listOwned).toHaveBeenCalledWith(OWNER_ID, {
      page: 1,
      pageSize: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      status: OrderStatus.PENDING_REVIEW,
      createdFrom: new Date('2026-08-01T00:00:00.000Z'),
      createdTo: new Date('2026-08-31T23:59:59.999Z'),
    });
    expect(page.data).toHaveLength(1);
    expect(page.meta).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('returns owned order detail', async () => {
    findOwnedById.mockResolvedValue(sampleOrder());

    const order = await service.getOwned(OWNER_ID, ORDER_ID);

    expect(findOwnedById).toHaveBeenCalledWith(ORDER_ID, OWNER_ID);
    expect(order.id).toBe(ORDER_ID);
  });

  it('throws ORDER_NOT_FOUND when owned lookup misses', async () => {
    findOwnedById.mockResolvedValue(null);

    await expect(service.getOwned(OWNER_ID, ORDER_ID)).rejects.toBeInstanceOf(
      OrderNotFoundError,
    );
  });

  it('builds the dispatch board from a bounded repository page', async () => {
    const regionId = '33333333-3333-4333-8333-333333333333';
    listDispatch.mockResolvedValue({
      matchedCount: 1,
      items: [
        {
          id: ORDER_ID,
          status: OrderStatus.CONFIRMED,
          customerPhone: '+989121234567',
          regionId,
          regionName: 'Tehran',
          total: 20_000n,
          lineCount: 1,
          deliveryAt: null,
          confirmedAt: new Date('2026-08-22T10:00:00.000Z'),
          shippedAt: null,
          createdAt: new Date('2026-08-22T10:00:00.000Z'),
        },
      ],
    });

    const board = await service.getDispatchBoard({
      regionId,
      status: OrderStatus.CONFIRMED,
    });

    expect(listDispatch).toHaveBeenCalledWith({
      regionId,
      status: OrderStatus.CONFIRMED,
    });
    expect(board.summary).toMatchObject({
      ordersCount: 1,
      confirmedCount: 1,
      regionCount: 1,
      truncated: false,
      matchedCount: 1,
    });
    expect(board.groups[0]!.region.name).toBe('Tehran');
  });
});

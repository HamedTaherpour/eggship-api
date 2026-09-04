import { AnalyticsService } from './analytics.service';

describe('AnalyticsService', () => {
  const product = {
    id: 'p',
    name: 'Eggs',
    price: 140,
    isActive: false,
    createdAt: new Date('2025-12-01T00:00:00Z'),
  };
  const inventory = {
    onHand: 10,
    reserved: 2,
    updatedAt: new Date('2026-01-03T00:00:00Z'),
  };

  it('keeps reservations out of physical daily stock and aggregates signed movements', async () => {
    const repository = {
      findProductWithInventory: jest
        .fn()
        .mockResolvedValue({ ...product, inventory }),
      listLedgerFrom: jest.fn().mockResolvedValue([
        {
          id: '1',
          type: 'RECEIVE',
          quantity: 5,
          onHandDelta: 5,
          createdAt: new Date('2026-01-01T01:00:00Z'),
        },
        {
          id: '2',
          type: 'RESERVE',
          quantity: 2,
          onHandDelta: 0,
          createdAt: new Date('2026-01-01T02:00:00Z'),
        },
        {
          id: '3',
          type: 'ADJUST',
          quantity: 1,
          onHandDelta: -1,
          createdAt: new Date('2026-01-02T01:00:00Z'),
        },
        {
          id: '4',
          type: 'WRITE_OFF',
          quantity: 1,
          onHandDelta: -1,
          createdAt: new Date('2026-01-02T02:00:00Z'),
        },
        {
          id: '5',
          type: 'RETURN_TO_STOCK',
          quantity: 2,
          onHandDelta: 2,
          createdAt: new Date('2026-01-02T03:00:00Z'),
        },
        {
          id: '6',
          type: 'SHIP',
          quantity: 1,
          onHandDelta: -1,
          createdAt: new Date('2026-01-03T01:00:00Z'),
        },
      ]),
    };
    const result = await new AnalyticsService(repository as never).dailyStock(
      'p',
      '2026-01-01',
      '2026-01-03',
    );
    expect(result.days).toEqual([
      expect.objectContaining({
        openingStock: 6,
        received: 5,
        closingStock: 11,
      }),
      expect.objectContaining({
        openingStock: 11,
        adjustment: -1,
        writeOff: 1,
        returnedToStock: 2,
        closingStock: 11,
      }),
      expect.objectContaining({
        openingStock: 11,
        shipped: 1,
        closingStock: 10,
      }),
    ]);
    expect(repository.listLedgerFrom).toHaveBeenCalledTimes(1);
  });

  it('returns current price separately from the inferred initial anchor and preserves changes', async () => {
    const repository = {
      findProductWithInventory: jest
        .fn()
        .mockResolvedValue({ ...product, inventory }),
      listPriceHistoryBefore: jest.fn().mockResolvedValue([
        {
          id: 'a',
          oldPrice: 100,
          newPrice: 120,
          createdAt: new Date('2026-01-01T01:00:00Z'),
        },
        {
          id: 'b',
          oldPrice: 120,
          newPrice: 140,
          createdAt: new Date('2026-01-01T01:00:00Z'),
        },
      ]),
    };
    const result = await new AnalyticsService(repository as never).priceHistory(
      'p',
      '2026-01-01',
      '2026-01-02',
    );
    expect(result.currentPrice).toBe(140);
    expect(result.initialPrice).toMatchObject({ price: 100, inferred: true });
    expect(result.changes).toHaveLength(2);
    expect(result.changes.map((change) => change.id)).toEqual(['a', 'b']);
  });

  it('maps sales aggregates without allowing lifecycle timestamps to affect sales', async () => {
    const repository = {
      salesOverview: jest.fn().mockResolvedValue({
        ordersCreated: 2n,
        createdOrderValue: 900n,
        ordersConfirmed: 1n,
        ordersShipped: 1n,
        ordersDelivered: 1n,
        ordersCancelled: 1n,
        cancelledOrderValue: 300n,
        grossSales: 500n,
        lineDiscounts: 40n,
        orderDiscounts: 60n,
        netSales: 400n,
        awaitingReviewCurrent: 3n,
      }),
    };
    const result = await new AnalyticsService(
      repository as never,
    ).salesOverview('2026-01-01', '2026-01-01');
    expect(result).toEqual(
      expect.objectContaining({
        ordersCreated: 2,
        createdOrderValue: 900,
        ordersCancelled: 1,
        cancelledOrderValue: 300,
        grossSales: 500,
        totalDiscounts: 100,
        netSales: 400,
      }),
    );
  });

  it('keeps today pulse current-state queue counts independent from today events', async () => {
    const repository = {
      salesOverview: jest.fn().mockResolvedValue({
        ordersCreated: 1n,
        createdOrderValue: 100n,
        ordersConfirmed: 0n,
        ordersShipped: 0n,
        ordersDelivered: 0n,
        ordersCancelled: 0n,
        cancelledOrderValue: 0n,
        grossSales: 0n,
        lineDiscounts: 0n,
        orderDiscounts: 0n,
        netSales: 0n,
        awaitingReviewCurrent: 7n,
      }),
      inventoryPulse: jest.fn().mockResolvedValue({
        stockReceived: 4n,
        stockShipped: 2n,
        stockReturnedToStock: 1n,
      }),
    };
    const result = await new AnalyticsService(repository as never).todayPulse(
      new Date('2026-01-01T20:30:00.000Z'),
    );
    expect(result).toEqual(
      expect.objectContaining({
        ordersCreated: 1,
        awaitingReviewCurrent: 7,
        stockReceived: 4,
        stockShipped: 2,
        stockReturnedToStock: 1,
      }),
    );
  });
});

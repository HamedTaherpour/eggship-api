import { inspectAvailability } from './availability-inspection';

describe('availability inspection', () => {
  it('reports every shortage and missing row without mutating balances', () => {
    const inspection = inspectAvailability({
      requested: [
        { productId: 'a', quantity: 4 },
        { productId: 'b', quantity: 1 },
        { productId: 'c', quantity: 2 },
      ],
      locked: [
        { productId: 'a', available: 3 },
        { productId: 'b', available: 1 },
      ],
    });

    expect(inspection.missingProductIds).toEqual(['c']);
    expect(inspection.shortages).toEqual([
      { productId: 'a', requested: 4, available: 3 },
    ]);
  });
});

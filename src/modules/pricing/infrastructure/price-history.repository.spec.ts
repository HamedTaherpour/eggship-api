import {
  assertPriceHistoryRepositoryIsAppendOnly,
  PRICE_HISTORY_TOMAN_BOUNDS,
  PriceHistoryRepository,
} from './price-history.repository';

describe('PriceHistoryRepository surface', () => {
  it('is append-only at the repository API level', () => {
    expect(() =>
      assertPriceHistoryRepositoryIsAppendOnly(
        new PriceHistoryRepository({} as never),
      ),
    ).not.toThrow();
  });

  it('aligns Toman bounds with Product price policy', () => {
    expect(PRICE_HISTORY_TOMAN_BOUNDS.min).toBe(1);
    expect(PRICE_HISTORY_TOMAN_BOUNDS.max).toBe(2_147_483_647);
  });
});

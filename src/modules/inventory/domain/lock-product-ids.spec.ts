import { InventoryInvalidQuantityError } from './inventory-errors';
import { normalizeProductIdsForLock } from './lock-product-ids';

const FIRST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECOND = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('lock product id normalization', () => {
  it('deduplicates and sorts product ids ascending without SQL identifiers', () => {
    expect(
      normalizeProductIdsForLock([SECOND.toUpperCase(), FIRST, SECOND]),
    ).toEqual([FIRST, SECOND]);
  });

  it('rejects non-UUID product ids before any lock is taken', () => {
    expect(() => normalizeProductIdsForLock(['Inventory; DROP TABLE'])).toThrow(
      InventoryInvalidQuantityError,
    );
  });
});

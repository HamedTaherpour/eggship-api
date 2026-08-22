import { InventoryInvalidQuantityError } from './inventory-errors';
import { INVENTORY_INT4_MAX } from './inventory-quantity';
import {
  collapseReservationLines,
  shortageDetailsWithoutAvailability,
} from './reservation-lines';

const PRODUCT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRODUCT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('reservation line collapse', () => {
  it('sums duplicate product ids and sorts by productId ascending', () => {
    expect(
      collapseReservationLines([
        { productId: PRODUCT_B, quantity: 2 },
        { productId: PRODUCT_A.toUpperCase(), quantity: 2 },
        { productId: PRODUCT_A, quantity: 3 },
      ]),
    ).toEqual([
      { productId: PRODUCT_A, quantity: 5 },
      { productId: PRODUCT_B, quantity: 2 },
    ]);
  });

  it('rejects an empty line list', () => {
    expect(() => collapseReservationLines([])).toThrow(
      InventoryInvalidQuantityError,
    );
  });

  it('rejects non-positive quantities and non-UUID product ids', () => {
    expect(() =>
      collapseReservationLines([{ productId: PRODUCT_A, quantity: 0 }]),
    ).toThrow(InventoryInvalidQuantityError);
    expect(() =>
      collapseReservationLines([{ productId: 'not-a-uuid', quantity: 1 }]),
    ).toThrow(InventoryInvalidQuantityError);
  });

  it('rejects collapsed quantities that overflow int4', () => {
    expect(() =>
      collapseReservationLines([
        { productId: PRODUCT_A, quantity: INVENTORY_INT4_MAX },
        { productId: PRODUCT_A, quantity: 1 },
      ]),
    ).toThrow(InventoryInvalidQuantityError);
  });

  it('omits available quantity from shortage details', () => {
    expect(
      shortageDetailsWithoutAvailability([
        { productId: PRODUCT_A, requested: 5 },
      ]),
    ).toEqual({
      lines: [{ productId: PRODUCT_A, requested: 5 }],
    });
  });
});

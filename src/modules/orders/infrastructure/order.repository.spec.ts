import { OrderInvalidLineError } from '../domain/order-errors';
import { collapseOrderLinesForTest } from '../infrastructure/order.repository';

const PRODUCT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRODUCT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('order line collapse', () => {
  it('merges duplicate productId lines with matching snapshots', () => {
    expect(
      collapseOrderLinesForTest([
        { productId: PRODUCT_B, productName: 'B', unitPrice: 100, quantity: 2 },
        {
          productId: PRODUCT_A,
          productName: 'A',
          unitPrice: 200,
          quantity: 3,
        },
        {
          productId: PRODUCT_A,
          productName: 'A',
          unitPrice: 200,
          quantity: 2,
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        productId: PRODUCT_A,
        productName: 'A',
        unitPrice: 200,
        quantity: 5,
        lineTotal: 1000n,
      }),
      expect.objectContaining({
        productId: PRODUCT_B,
        productName: 'B',
        unitPrice: 100,
        quantity: 2,
        lineTotal: 200n,
      }),
    ]);
  });

  it('rejects duplicate productId with mismatched unit price snapshots', () => {
    expect(() =>
      collapseOrderLinesForTest([
        {
          productId: PRODUCT_A,
          productName: 'A',
          unitPrice: 200,
          quantity: 1,
        },
        {
          productId: PRODUCT_A,
          productName: 'A',
          unitPrice: 300,
          quantity: 1,
        },
      ]),
    ).toThrow(OrderInvalidLineError);
  });
});

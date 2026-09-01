import {
  assertOrderReturnInput,
  assertOrderReturnLineQuantities,
  normalizeOrderReturnReason,
} from './order-return';
import { OrderInvalidInputError } from './order-errors';

describe('Order return domain primitives', () => {
  it('trims and accepts a required reason', () => {
    expect(normalizeOrderReturnReason('  damaged carton  ')).toBe(
      'damaged carton',
    );
  });

  it.each([undefined, '', '   ', 'x'.repeat(501)])(
    'rejects invalid reason %p',
    (reason) => {
      expect(() => normalizeOrderReturnReason(reason)).toThrow(
        OrderInvalidInputError,
      );
    },
  );

  it.each([
    { sellableQuantity: -1, damagedQuantity: 1 },
    { sellableQuantity: 1, damagedQuantity: -1 },
    { sellableQuantity: 0, damagedQuantity: 0 },
  ])('rejects invalid quantities', (line) => {
    expect(() =>
      assertOrderReturnLineQuantities({ orderLineId: 'line', ...line }),
    ).toThrow(OrderInvalidInputError);
  });

  it('accepts mixed inspected quantities and a non-empty line set', () => {
    expect(() =>
      assertOrderReturnInput({
        orderId: 'order',
        recordedByAdminId: 'admin',
        reason: 'inspection complete',
        idempotencyKey: 'key',
        idempotencyPayloadHash: 'hash',
        lines: [
          { orderLineId: 'line', sellableQuantity: 2, damagedQuantity: 1 },
        ],
      }),
    ).not.toThrow();
  });
});

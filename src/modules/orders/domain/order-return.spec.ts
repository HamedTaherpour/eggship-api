import {
  assertOrderReturnInput,
  assertOrderReturnLineQuantities,
  hashOrderReturnPayload,
  normalizeOrderReturnReason,
} from './order-return';
import { OrderInvalidInputError } from './order-errors';

describe('Order return domain primitives', () => {
  it('trims and accepts a required reason', () => {
    expect(normalizeOrderReturnReason('  damaged carton  ')).toBe(
      'damaged carton',
    );
  });

  it('rejects duplicate order-line ids and canonicalizes payload line order', () => {
    expect(() =>
      assertOrderReturnInput({
        orderId: 'order',
        recordedByAdminId: 'admin',
        reason: 'inspection',
        idempotencyKey: 'key',
        idempotencyPayloadHash: 'a'.repeat(64),
        lines: [
          { orderLineId: 'line', sellableQuantity: 1, damagedQuantity: 0 },
          { orderLineId: 'line', sellableQuantity: 0, damagedQuantity: 1 },
        ],
      }),
    ).toThrow(OrderInvalidInputError);

    expect(
      hashOrderReturnPayload({
        orderId: 'ORDER',
        reason: ' inspection ',
        lines: [
          { orderLineId: 'b', sellableQuantity: 0, damagedQuantity: 1 },
          { orderLineId: 'a', sellableQuantity: 1, damagedQuantity: 0 },
        ],
      }),
    ).toBe(
      hashOrderReturnPayload({
        orderId: 'order',
        reason: 'inspection',
        lines: [
          { orderLineId: 'a', sellableQuantity: 1, damagedQuantity: 0 },
          { orderLineId: 'b', sellableQuantity: 0, damagedQuantity: 1 },
        ],
      }),
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

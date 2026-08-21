import {
  InventoryErrorCode,
  InventoryInsufficientStockError,
  InventoryInvalidAdjustmentError,
  InventoryInvalidQuantityError,
  InventoryNotFoundError,
  InventoryReservationConflictError,
  InventoryReservationNotFoundError,
} from './inventory-errors';

describe('Inventory errors', () => {
  it('uses stable codes and safe messages without SQL details', () => {
    const errors = [
      new InventoryNotFoundError(),
      new InventoryInsufficientStockError(),
      new InventoryInvalidQuantityError(),
      new InventoryInvalidAdjustmentError(),
      new InventoryReservationNotFoundError(),
      new InventoryReservationConflictError(),
    ];

    expect(errors.map((error) => error.code)).toEqual([
      InventoryErrorCode.NOT_FOUND,
      InventoryErrorCode.INSUFFICIENT_STOCK,
      InventoryErrorCode.INVALID_QUANTITY,
      InventoryErrorCode.INVALID_ADJUSTMENT,
      InventoryErrorCode.RESERVATION_NOT_FOUND,
      InventoryErrorCode.RESERVATION_CONFLICT,
    ]);

    for (const error of errors) {
      expect(error.message).not.toMatch(/SQLSTATE|P20\d{2}|FOR UPDATE/u);
      expect(error.details).toEqual({});
    }
  });

  it('carries structured safe details when provided', () => {
    const error = new InventoryInsufficientStockError(
      'Not enough available stock for this reservation.',
      {
        productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        requested: 2,
      },
    );
    expect(error.details).toEqual({
      productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      requested: 2,
    });
    expect(error.httpStatus).toBe(409);
  });
});

import {
  classifyReleaseAgainstExisting,
  classifyReserveAgainstExisting,
  classifyShipAgainstExisting,
  OrderReleasePlan,
  OrderReservePlan,
  OrderShipPlan,
  reservationProductIdsMatch,
} from './order-reservation-state';
import {
  InventoryReservationStatus,
  type InventoryReservation,
} from './inventory-reservation';

const PRODUCT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRODUCT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function row(
  overrides: Partial<InventoryReservation> &
    Pick<InventoryReservation, 'productId' | 'quantity' | 'status'>,
): InventoryReservation {
  const now = new Date('2026-08-22T00:00:00.000Z');
  return {
    id: `${overrides.productId.slice(0, 8)}-1111-4111-8111-111111111111`,
    orderId: ORDER_ID,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('order reservation classification', () => {
  it('treats no existing rows as a fresh reserve', () => {
    expect(
      classifyReserveAgainstExisting(
        [{ productId: PRODUCT_A, quantity: 2 }],
        [],
      ),
    ).toBe(OrderReservePlan.FRESH);
  });

  it('replays only when every ACTIVE row matches the requested set', () => {
    expect(
      classifyReserveAgainstExisting(
        [
          { productId: PRODUCT_A, quantity: 2 },
          { productId: PRODUCT_B, quantity: 3 },
        ],
        [
          row({
            productId: PRODUCT_A,
            quantity: 2,
            status: InventoryReservationStatus.ACTIVE,
          }),
          row({
            productId: PRODUCT_B,
            quantity: 3,
            status: InventoryReservationStatus.ACTIVE,
          }),
        ],
      ),
    ).toBe(OrderReservePlan.REPLAY);
  });

  it('conflicts on quantity mismatch, extra products, or partial rows', () => {
    expect(
      classifyReserveAgainstExisting(
        [{ productId: PRODUCT_A, quantity: 2 }],
        [
          row({
            productId: PRODUCT_A,
            quantity: 3,
            status: InventoryReservationStatus.ACTIVE,
          }),
        ],
      ),
    ).toBe(OrderReservePlan.CONFLICT);

    expect(
      classifyReserveAgainstExisting(
        [
          { productId: PRODUCT_A, quantity: 2 },
          { productId: PRODUCT_B, quantity: 1 },
        ],
        [
          row({
            productId: PRODUCT_A,
            quantity: 2,
            status: InventoryReservationStatus.ACTIVE,
          }),
        ],
      ),
    ).toBe(OrderReservePlan.CONFLICT);

    expect(
      classifyReserveAgainstExisting(
        [{ productId: PRODUCT_A, quantity: 2 }],
        [
          row({
            productId: PRODUCT_A,
            quantity: 2,
            status: InventoryReservationStatus.RELEASED,
          }),
        ],
      ),
    ).toBe(OrderReservePlan.CONFLICT);
  });

  it('releases only when every row is ACTIVE and replays all-RELEASED', () => {
    expect(
      classifyReleaseAgainstExisting([
        row({
          productId: PRODUCT_A,
          quantity: 1,
          status: InventoryReservationStatus.ACTIVE,
        }),
        row({
          productId: PRODUCT_B,
          quantity: 2,
          status: InventoryReservationStatus.ACTIVE,
        }),
      ]),
    ).toBe(OrderReleasePlan.RELEASE);

    expect(
      classifyReleaseAgainstExisting([
        row({
          productId: PRODUCT_A,
          quantity: 1,
          status: InventoryReservationStatus.RELEASED,
        }),
      ]),
    ).toBe(OrderReleasePlan.REPLAY);
  });

  it('conflicts mixed or SHIPPED release state and reports empty as not found', () => {
    expect(classifyReleaseAgainstExisting([])).toBe(OrderReleasePlan.NOT_FOUND);

    expect(
      classifyReleaseAgainstExisting([
        row({
          productId: PRODUCT_A,
          quantity: 1,
          status: InventoryReservationStatus.ACTIVE,
        }),
        row({
          productId: PRODUCT_B,
          quantity: 1,
          status: InventoryReservationStatus.RELEASED,
        }),
      ]),
    ).toBe(OrderReleasePlan.CONFLICT);

    expect(
      classifyReleaseAgainstExisting([
        row({
          productId: PRODUCT_A,
          quantity: 1,
          status: InventoryReservationStatus.SHIPPED,
        }),
      ]),
    ).toBe(OrderReleasePlan.CONFLICT);
  });

  it('ships only when every row is ACTIVE and replays all-SHIPPED', () => {
    expect(
      classifyShipAgainstExisting([
        row({
          productId: PRODUCT_A,
          quantity: 1,
          status: InventoryReservationStatus.ACTIVE,
        }),
        row({
          productId: PRODUCT_B,
          quantity: 2,
          status: InventoryReservationStatus.ACTIVE,
        }),
      ]),
    ).toBe(OrderShipPlan.SHIP);

    expect(
      classifyShipAgainstExisting([
        row({
          productId: PRODUCT_A,
          quantity: 1,
          status: InventoryReservationStatus.SHIPPED,
        }),
      ]),
    ).toBe(OrderShipPlan.REPLAY);
  });

  it('conflicts mixed, RELEASED, or empty ship state', () => {
    expect(classifyShipAgainstExisting([])).toBe(OrderShipPlan.NOT_FOUND);

    expect(
      classifyShipAgainstExisting([
        row({
          productId: PRODUCT_A,
          quantity: 1,
          status: InventoryReservationStatus.RELEASED,
        }),
      ]),
    ).toBe(OrderShipPlan.CONFLICT);

    expect(
      classifyShipAgainstExisting([
        row({
          productId: PRODUCT_A,
          quantity: 1,
          status: InventoryReservationStatus.ACTIVE,
        }),
        row({
          productId: PRODUCT_B,
          quantity: 1,
          status: InventoryReservationStatus.SHIPPED,
        }),
      ]),
    ).toBe(OrderShipPlan.CONFLICT);
  });

  it('detects reservation product-set drift after locking', () => {
    expect(
      reservationProductIdsMatch(
        [PRODUCT_A, PRODUCT_B],
        [
          row({
            productId: PRODUCT_A,
            quantity: 1,
            status: InventoryReservationStatus.ACTIVE,
          }),
          row({
            productId: PRODUCT_B,
            quantity: 1,
            status: InventoryReservationStatus.ACTIVE,
          }),
        ],
      ),
    ).toBe(true);
    expect(
      reservationProductIdsMatch(
        [PRODUCT_A],
        [
          row({
            productId: PRODUCT_A,
            quantity: 1,
            status: InventoryReservationStatus.ACTIVE,
          }),
          row({
            productId: PRODUCT_B,
            quantity: 1,
            status: InventoryReservationStatus.ACTIVE,
          }),
        ],
      ),
    ).toBe(false);
  });
});

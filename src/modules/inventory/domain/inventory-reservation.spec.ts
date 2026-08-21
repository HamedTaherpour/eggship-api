import {
  canTransitionReservation,
  InventoryReservationStatus,
} from './inventory-reservation';

describe('Inventory reservation status', () => {
  it('allows only ACTIVE to RELEASED or SHIPPED', () => {
    expect(
      canTransitionReservation(
        InventoryReservationStatus.ACTIVE,
        InventoryReservationStatus.RELEASED,
      ),
    ).toBe(true);
    expect(
      canTransitionReservation(
        InventoryReservationStatus.ACTIVE,
        InventoryReservationStatus.SHIPPED,
      ),
    ).toBe(true);
  });

  it('rejects repeat or reverse transitions', () => {
    expect(
      canTransitionReservation(
        InventoryReservationStatus.RELEASED,
        InventoryReservationStatus.RELEASED,
      ),
    ).toBe(false);
    expect(
      canTransitionReservation(
        InventoryReservationStatus.SHIPPED,
        InventoryReservationStatus.RELEASED,
      ),
    ).toBe(false);
    expect(
      canTransitionReservation(
        InventoryReservationStatus.RELEASED,
        InventoryReservationStatus.SHIPPED,
      ),
    ).toBe(false);
    expect(
      canTransitionReservation(
        InventoryReservationStatus.ACTIVE,
        InventoryReservationStatus.ACTIVE,
      ),
    ).toBe(false);
  });
});

export const InventoryReservationStatus = {
  ACTIVE: 'ACTIVE',
  RELEASED: 'RELEASED',
  SHIPPED: 'SHIPPED',
} as const;

export type InventoryReservationStatus =
  (typeof InventoryReservationStatus)[keyof typeof InventoryReservationStatus];

export interface InventoryReservation {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  status: InventoryReservationStatus;
  createdAt: Date;
  updatedAt: Date;
}

export function canTransitionReservation(
  from: InventoryReservationStatus,
  to: InventoryReservationStatus,
): boolean {
  return (
    from === InventoryReservationStatus.ACTIVE &&
    (to === InventoryReservationStatus.RELEASED ||
      to === InventoryReservationStatus.SHIPPED)
  );
}

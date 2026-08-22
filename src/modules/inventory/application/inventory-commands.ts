import type { TransactionContext } from '../../../infrastructure/database/transaction';
import type { InventoryBalance } from '../domain/inventory-balance';
import type {
  InventoryActor,
  InventoryLedgerEntry,
} from '../domain/inventory-ledger';
import type {
  InventoryReservation,
  InventoryReservationStatus,
} from '../domain/inventory-reservation';
import type { ReservationLineInput } from '../domain/reservation-lines';

export interface InventoryMutationActor {
  actor: InventoryActor;
  correlationId?: string | null;
}

export interface ReserveForOrderInput extends InventoryMutationActor {
  orderId: string;
  lines: readonly ReservationLineInput[];
}

export interface ReleaseForOrderInput extends InventoryMutationActor {
  orderId: string;
}

export interface CompleteReservationInput extends InventoryMutationActor {
  orderId: string;
  productId: string;
}

export interface OnHandIncreaseInput extends InventoryMutationActor {
  productId: string;
  quantity: number;
  referenceType: 'RECEIVE' | 'RETURN' | 'RECONCILIATION';
  referenceId: string | null;
  reason?: string | null;
}

export interface AdjustOnHandInput extends InventoryMutationActor {
  productId: string;
  delta: number;
  referenceType: 'ADJUSTMENT' | 'RECONCILIATION';
  referenceId: string | null;
  reason: string;
}

export interface WriteOffOnHandInput extends InventoryMutationActor {
  productId: string;
  quantity: number;
  referenceType: 'ADJUSTMENT' | 'RECONCILIATION';
  referenceId: string | null;
  reason: string;
}

export interface OrderReservationLine {
  productId: string;
  quantity: number;
  status: InventoryReservationStatus;
}

export interface OrderReservationResult {
  orderId: string;
  lines: OrderReservationLine[];
}

export interface ReservationMutationResult {
  balance: InventoryBalance;
  reservation: InventoryReservation;
  ledger: InventoryLedgerEntry | null;
}

export interface BalanceMutationResult {
  balance: InventoryBalance;
  ledger: InventoryLedgerEntry;
}

export interface LockAndInspectInput {
  items: ReadonlyArray<{ productId: string; quantity: number }>;
  tx: TransactionContext;
}

import type { TransactionContext } from '../../../infrastructure/database/transaction';
import type { InventoryBalance } from '../domain/inventory-balance';
import type {
  InventoryActor,
  InventoryLedgerEntry,
} from '../domain/inventory-ledger';
import type { InventoryReservation } from '../domain/inventory-reservation';

export interface InventoryMutationActor {
  actor: InventoryActor;
  correlationId?: string | null;
}

export interface ReserveForOrderInput extends InventoryMutationActor {
  orderId: string;
  productId: string;
  quantity: number;
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

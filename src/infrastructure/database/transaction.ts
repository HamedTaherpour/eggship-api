/**
 * Opaque modular-monolith transaction handle (INV-01B / ADR 0012).
 * Domain and application code may accept this type; they must not unwrap it.
 * Prisma lives only in the infrastructure adapter.
 */
export const TRANSACTION_CONTEXT_BRAND: unique symbol = Symbol(
  'eggship.TransactionContext',
);

export interface TransactionContext {
  readonly [TRANSACTION_CONTEXT_BRAND]: true;
}

/**
 * Runs work in a PostgreSQL transaction, or joins a caller-supplied context.
 * Not a generic unit-of-work framework — Inventory (and later Orders) need to
 * share one transaction without importing Prisma types.
 */
export abstract class TransactionRunner {
  abstract run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T>;

  abstract runIn<T>(
    existing: TransactionContext | undefined,
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T>;

  /**
   * Read-only diagnostic snapshot (INV-05). Uses PostgreSQL REPEATABLE READ so
   * Inventory, reservations, and ledger reads share one coherent view without
   * row-level write locks over history scans.
   */
  abstract runSnapshotRead<T>(
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T>;

  /**
   * Read/write transaction at PostgreSQL REPEATABLE READ (ORD-03).
   * Used when pricing and persistence must share one coherent Product/Discount
   * snapshot inside the same create transaction.
   */
  abstract runRepeatableRead<T>(
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T>;
}

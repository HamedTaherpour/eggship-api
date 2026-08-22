import { randomUUID } from 'node:crypto';
import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import {
  TRANSACTION_CONTEXT_BRAND,
  type TransactionContext,
  TransactionRunner,
} from '../../../infrastructure/database/transaction';
import type { InventoryBalance } from '../domain/inventory-balance';
import { InventoryReconciliationStatus } from '../domain/inventory-reconciliation';
import { InventoryNotFoundError } from '../domain/inventory-errors';
import type { InventoryBalanceRepository } from '../infrastructure/inventory-balance.repository';
import type { InventoryLedgerRepository } from '../infrastructure/inventory-ledger.repository';
import type { InventoryReservationRepository } from '../infrastructure/inventory-reservation.repository';
import { InventoryReconciliationService } from './inventory-reconciliation.service';

const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

class SnapshotTransactionRunner extends TransactionRunner {
  override run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return fn({ [TRANSACTION_CONTEXT_BRAND]: true });
  }

  override runIn<T>(
    existing: TransactionContext | undefined,
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return fn(existing ?? { [TRANSACTION_CONTEXT_BRAND]: true });
  }

  override runSnapshotRead<T>(
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return fn({ [TRANSACTION_CONTEXT_BRAND]: true });
  }
  override runRepeatableRead<T>(
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return this.runSnapshotRead(fn);
  }
}

function balance(overrides: Partial<InventoryBalance> = {}): InventoryBalance {
  const now = new Date('2026-08-22T12:00:00.000Z');
  return {
    productId: PRODUCT_ID,
    onHand: 10,
    reserved: 0,
    available: 10,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('InventoryReconciliationService', () => {
  let transactions: SnapshotTransactionRunner;
  let balances: jest.Mocked<
    Pick<InventoryBalanceRepository, 'findByProductId'>
  >;
  let reservations: jest.Mocked<
    Pick<InventoryReservationRepository, 'listByProduct'>
  >;
  let ledger: jest.Mocked<Pick<InventoryLedgerRepository, 'listByProduct'>>;
  let logger: jest.Mocked<Pick<ApplicationLogger, 'info'>>;
  let service: InventoryReconciliationService;

  let runSnapshotReadSpy: jest.SpiedFunction<
    TransactionRunner['runSnapshotRead']
  >;

  beforeEach(() => {
    transactions = new SnapshotTransactionRunner();
    runSnapshotReadSpy = jest.spyOn(transactions, 'runSnapshotRead');
    balances = { findByProductId: jest.fn() };
    reservations = { listByProduct: jest.fn().mockResolvedValue([]) };
    ledger = { listByProduct: jest.fn().mockResolvedValue([]) };
    logger = { info: jest.fn() };
    service = new InventoryReconciliationService(
      transactions,
      balances as unknown as InventoryBalanceRepository,
      reservations as unknown as InventoryReservationRepository,
      ledger as unknown as InventoryLedgerRepository,
      logger as unknown as ApplicationLogger,
    );
  });

  it('delegates snapshot reads to TransactionRunner.runSnapshotRead', async () => {
    balances.findByProductId.mockResolvedValue(balance());

    await service.reconcileProduct(PRODUCT_ID);

    expect(runSnapshotReadSpy).toHaveBeenCalledTimes(1);
  });

  it('throws when inventory is missing inside the snapshot transaction', async () => {
    balances.findByProductId.mockResolvedValue(null);

    await expect(service.reconcileProduct(PRODUCT_ID)).rejects.toBeInstanceOf(
      InventoryNotFoundError,
    );
  });

  it('logs completion telemetry without dumping ledger rows', async () => {
    balances.findByProductId.mockResolvedValue(
      balance({ onHand: 5, available: 5 }),
    );
    ledger.listByProduct.mockResolvedValue([
      {
        id: randomUUID(),
        productId: PRODUCT_ID,
        type: 'RECEIVE',
        quantity: 5,
        onHandDelta: 5,
        reservedDelta: 0,
        onHandAfter: 5,
        reservedAfter: 0,
        referenceType: 'RECEIVE',
        referenceId: randomUUID(),
        reason: null,
        actorType: 'SYSTEM',
        actorId: null,
        correlationId: null,
        createdAt: new Date('2026-08-22T10:00:00.000Z'),
      },
    ]);

    const result = await service.reconcileProduct(PRODUCT_ID);

    expect(result.status).toBe(InventoryReconciliationStatus.CONSISTENT);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'inventory.reconciliation.completed',
        productId: PRODUCT_ID,
        consistent: true,
        issueCount: 0,
      }),
      expect.any(String),
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('onHandDelta');
  });
});

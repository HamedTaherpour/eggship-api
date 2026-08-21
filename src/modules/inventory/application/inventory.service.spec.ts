import { randomUUID } from 'node:crypto';
import {
  TRANSACTION_CONTEXT_BRAND,
  type TransactionContext,
  TransactionRunner,
} from '../../../infrastructure/database/transaction';
import type { InventoryBalance } from '../domain/inventory-balance';
import {
  InventoryLedgerActorType,
  InventoryLedgerReferenceType,
  InventoryLedgerType,
  type InventoryLedgerEntry,
} from '../domain/inventory-ledger';
import { InventoryReservationConflictError } from '../domain/inventory-errors';
import {
  InventoryReservationStatus,
  type InventoryReservation,
} from '../domain/inventory-reservation';
import type { InventoryBalanceRepository } from '../infrastructure/inventory-balance.repository';
import type { InventoryLedgerRepository } from '../infrastructure/inventory-ledger.repository';
import type { InventoryReservationRepository } from '../infrastructure/inventory-reservation.repository';
import { InventoryService, SYSTEM_ACTOR } from './inventory.service';

const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

class ImmediateTransactionRunner extends TransactionRunner {
  override run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return fn({ [TRANSACTION_CONTEXT_BRAND]: true });
  }

  override runIn<T>(
    existing: TransactionContext | undefined,
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return fn(existing ?? { [TRANSACTION_CONTEXT_BRAND]: true });
  }
}

function balance(overrides: Partial<InventoryBalance> = {}): InventoryBalance {
  const now = new Date('2026-08-22T00:00:00.000Z');
  return {
    productId: PRODUCT_ID,
    onHand: 10,
    reserved: 1,
    available: 9,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function reservation(
  overrides: Partial<InventoryReservation> = {},
): InventoryReservation {
  const now = new Date('2026-08-22T00:00:00.000Z');
  return {
    id: randomUUID(),
    orderId: ORDER_ID,
    productId: PRODUCT_ID,
    quantity: 1,
    status: InventoryReservationStatus.ACTIVE,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function ledgerEntry(
  overrides: Partial<InventoryLedgerEntry> = {},
): InventoryLedgerEntry {
  return {
    id: randomUUID(),
    productId: PRODUCT_ID,
    type: InventoryLedgerType.RESERVE,
    quantity: 1,
    onHandDelta: 0,
    reservedDelta: 1,
    onHandAfter: 10,
    reservedAfter: 1,
    referenceType: InventoryLedgerReferenceType.ORDER,
    referenceId: ORDER_ID,
    reason: null,
    actorType: InventoryLedgerActorType.SYSTEM,
    actorId: null,
    correlationId: null,
    createdAt: new Date('2026-08-22T00:00:00.000Z'),
    ...overrides,
  };
}

describe('InventoryService persistence primitives', () => {
  let balances: jest.Mocked<
    Pick<
      InventoryBalanceRepository,
      | 'ensureForProduct'
      | 'findByProductId'
      | 'lockBalances'
      | 'reserveQuantity'
      | 'releaseQuantity'
      | 'shipQuantity'
      | 'incrementOnHand'
      | 'decrementOnHand'
      | 'adjustOnHand'
    >
  >;
  let reservations: jest.Mocked<
    Pick<
      InventoryReservationRepository,
      'insertActive' | 'findByOrderProduct' | 'transitionFromActive'
    >
  >;
  let ledger: jest.Mocked<
    Pick<InventoryLedgerRepository, 'append' | 'findOrderEvent'>
  >;
  let service: InventoryService;

  beforeEach(() => {
    balances = {
      ensureForProduct: jest.fn(),
      findByProductId: jest.fn(),
      lockBalances: jest.fn(),
      reserveQuantity: jest.fn(),
      releaseQuantity: jest.fn(),
      shipQuantity: jest.fn(),
      incrementOnHand: jest.fn(),
      decrementOnHand: jest.fn(),
      adjustOnHand: jest.fn(),
    };
    reservations = {
      insertActive: jest.fn(),
      findByOrderProduct: jest.fn(),
      transitionFromActive: jest.fn(),
    };
    ledger = {
      append: jest.fn(),
      findOrderEvent: jest.fn(),
    };
    service = new InventoryService(
      new ImmediateTransactionRunner(),
      balances as unknown as InventoryBalanceRepository,
      reservations as unknown as InventoryReservationRepository,
      ledger as unknown as InventoryLedgerRepository,
    );
  });

  it('reserves by mutating balance, inserting ACTIVE, and appending RESERVE together', async () => {
    const next = balance({ reserved: 1, available: 9 });
    const row = reservation();
    const entry = ledgerEntry();
    balances.lockBalances.mockResolvedValue([balance()]);
    balances.reserveQuantity.mockResolvedValue(next);
    reservations.insertActive.mockResolvedValue({
      reservation: row,
      inserted: true,
    });
    ledger.append.mockResolvedValue(entry);

    const result = await service.reserveForOrder({
      orderId: ORDER_ID,
      productId: PRODUCT_ID,
      quantity: 1,
      actor: SYSTEM_ACTOR,
    });

    expect(balances.lockBalances.mock.invocationCallOrder[0]).toBeLessThan(
      reservations.insertActive.mock.invocationCallOrder[0]!,
    );
    expect(reservations.insertActive.mock.invocationCallOrder[0]).toBeLessThan(
      balances.reserveQuantity.mock.invocationCallOrder[0]!,
    );

    expect(balances.reserveQuantity).toHaveBeenCalledWith(
      PRODUCT_ID,
      1,
      expect.anything(),
    );
    expect(reservations.insertActive).toHaveBeenCalledWith(
      { orderId: ORDER_ID, productId: PRODUCT_ID, quantity: 1 },
      expect.anything(),
    );
    expect(ledger.append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: InventoryLedgerType.RESERVE,
        reservedDelta: 1,
        onHandDelta: 0,
        referenceType: InventoryLedgerReferenceType.ORDER,
        referenceId: ORDER_ID,
      }),
      expect.anything(),
    );
    expect(result).toEqual({ balance: next, reservation: row, ledger: entry });
  });

  it('replays an identical ACTIVE reservation without incrementing again', async () => {
    const existing = reservation();
    balances.lockBalances.mockResolvedValue([balance()]);
    reservations.insertActive.mockResolvedValue({
      reservation: existing,
      inserted: false,
    });
    balances.findByProductId.mockResolvedValue(balance());
    ledger.findOrderEvent.mockResolvedValue(ledgerEntry());

    const result = await service.reserveForOrder({
      orderId: ORDER_ID,
      productId: PRODUCT_ID,
      quantity: 1,
      actor: SYSTEM_ACTOR,
    });

    expect(result.reservation).toEqual(existing);
    expect(balances.reserveQuantity).not.toHaveBeenCalled();
    expect(ledger.append).not.toHaveBeenCalled();
  });

  it('propagates reservation conflicts even when a caller transaction is joined', async () => {
    balances.lockBalances.mockResolvedValue([balance()]);
    reservations.insertActive.mockRejectedValue(
      new InventoryReservationConflictError(),
    );

    await expect(
      service.reserveForOrder(
        {
          orderId: ORDER_ID,
          productId: PRODUCT_ID,
          quantity: 1,
          actor: SYSTEM_ACTOR,
        },
        { [TRANSACTION_CONTEXT_BRAND]: true },
      ),
    ).rejects.toBeInstanceOf(InventoryReservationConflictError);
    expect(balances.reserveQuantity).not.toHaveBeenCalled();
  });

  it('releases only from ACTIVE and is idempotent when already RELEASED', async () => {
    const active = reservation();
    balances.lockBalances.mockResolvedValue([
      balance({ reserved: 0, available: 10 }),
    ]);
    reservations.findByOrderProduct.mockResolvedValue(active);
    reservations.transitionFromActive.mockResolvedValue({
      reservation: { ...active, status: InventoryReservationStatus.RELEASED },
      transitioned: false,
    });
    balances.findByProductId.mockResolvedValue(
      balance({ reserved: 0, available: 10 }),
    );
    ledger.findOrderEvent.mockResolvedValue(
      ledgerEntry({ type: InventoryLedgerType.RELEASE, reservedDelta: -1 }),
    );

    const result = await service.releaseReservation({
      orderId: ORDER_ID,
      productId: PRODUCT_ID,
      actor: SYSTEM_ACTOR,
    });

    expect(balances.releaseQuantity).not.toHaveBeenCalled();
    expect(result.reservation.status).toBe(InventoryReservationStatus.RELEASED);
  });

  it('ships after a successful ACTIVE transition', async () => {
    const active = reservation({ quantity: 2 });
    const shipped = { ...active, status: InventoryReservationStatus.SHIPPED };
    balances.lockBalances.mockResolvedValue([balance()]);
    reservations.findByOrderProduct.mockResolvedValue(active);
    reservations.transitionFromActive.mockResolvedValue({
      reservation: shipped,
      transitioned: true,
    });
    balances.shipQuantity.mockResolvedValue(
      balance({ onHand: 8, reserved: 0, available: 8 }),
    );
    ledger.append.mockResolvedValue(
      ledgerEntry({
        type: InventoryLedgerType.SHIP,
        quantity: 2,
        onHandDelta: -2,
        reservedDelta: -2,
      }),
    );

    await service.shipReservation({
      orderId: ORDER_ID,
      productId: PRODUCT_ID,
      actor: SYSTEM_ACTOR,
    });

    expect(balances.shipQuantity).toHaveBeenCalledWith(
      PRODUCT_ID,
      2,
      expect.anything(),
    );
  });

  it('inspects multi-SKU availability after locking, without writing', async () => {
    balances.lockBalances.mockResolvedValue([
      balance({ productId: PRODUCT_ID, onHand: 2, reserved: 0, available: 2 }),
    ]);

    const result = await service.lockAndInspectAvailability({
      items: [{ productId: PRODUCT_ID, quantity: 5 }],
      tx: { [TRANSACTION_CONTEXT_BRAND]: true },
    });

    expect(result.inspection.shortages).toEqual([
      { productId: PRODUCT_ID, requested: 5, available: 2 },
    ]);
    expect(balances.reserveQuantity).not.toHaveBeenCalled();
  });
});

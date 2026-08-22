import { randomUUID } from 'node:crypto';
import { RequestContextService } from '../../../common/observability/request-context.service';
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
import {
  InventoryInvalidQuantityError,
  InventoryNotFoundError,
  InventoryReservationConflictError,
} from '../domain/inventory-errors';
import { InventoryHttpMessage } from '../domain/inventory-http-messages';
import {
  InventoryReservationStatus,
  type InventoryReservation,
} from '../domain/inventory-reservation';
import type { InventoryBalanceRepository } from '../infrastructure/inventory-balance.repository';
import type { InventoryLedgerRepository } from '../infrastructure/inventory-ledger.repository';
import type { InventoryReservationRepository } from '../infrastructure/inventory-reservation.repository';
import { InventoryService, SYSTEM_ACTOR } from './inventory.service';

const PRODUCT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRODUCT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PRODUCT_C = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CORRELATION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

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

  override runSnapshotRead<T>(
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return this.run(fn);
  }

  override runRepeatableRead<T>(
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return this.run(fn);
  }
}

function balance(overrides: Partial<InventoryBalance> = {}): InventoryBalance {
  const now = new Date('2026-08-22T00:00:00.000Z');
  return {
    productId: PRODUCT_A,
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
    productId: PRODUCT_A,
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
    productId: PRODUCT_A,
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

describe('InventoryService reservation contracts', () => {
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
      | 'insertActive'
      | 'findByOrderProduct'
      | 'findByOrderId'
      | 'lockByOrderId'
      | 'lockOrderScope'
      | 'transitionFromActive'
    >
  >;
  let ledger: jest.Mocked<
    Pick<InventoryLedgerRepository, 'append' | 'findOrderEvent'>
  >;
  let requestContext: RequestContextService;
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
      findByOrderId: jest.fn(),
      lockByOrderId: jest.fn(),
      lockOrderScope: jest.fn().mockResolvedValue(undefined),
      transitionFromActive: jest.fn(),
    };
    ledger = {
      append: jest.fn(),
      findOrderEvent: jest.fn(),
    };
    requestContext = new RequestContextService();
    service = new InventoryService(
      new ImmediateTransactionRunner(),
      balances as unknown as InventoryBalanceRepository,
      reservations as unknown as InventoryReservationRepository,
      ledger as unknown as InventoryLedgerRepository,
      requestContext,
    );
  });

  it('rejects empty lines and overflow before locking', async () => {
    await expect(
      service.reserveForOrder({
        orderId: ORDER_ID,
        lines: [],
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toBeInstanceOf(InventoryInvalidQuantityError);

    expect(reservations.lockOrderScope).not.toHaveBeenCalled();
    expect(balances.lockBalances).not.toHaveBeenCalled();
  });

  it('reserves collapsed lines after locking inventory, then reservations', async () => {
    const row = reservation({ quantity: 5 });
    const next = balance({ reserved: 6, available: 4 });
    balances.lockBalances.mockResolvedValue([balance({ available: 9 })]);
    reservations.lockByOrderId.mockResolvedValue([]);
    reservations.insertActive.mockResolvedValue({
      reservation: row,
      inserted: true,
    });
    balances.reserveQuantity.mockResolvedValue(next);
    ledger.append.mockResolvedValue(ledgerEntry({ quantity: 5 }));

    const result = await service.reserveForOrder({
      orderId: ORDER_ID,
      lines: [
        { productId: PRODUCT_A, quantity: 2 },
        { productId: PRODUCT_A, quantity: 3 },
      ],
      actor: SYSTEM_ACTOR,
    });

    expect(
      reservations.lockOrderScope.mock.invocationCallOrder[0],
    ).toBeLessThan(balances.lockBalances.mock.invocationCallOrder[0]!);
    expect(balances.lockBalances.mock.invocationCallOrder[0]).toBeLessThan(
      reservations.lockByOrderId.mock.invocationCallOrder[0]!,
    );
    expect(reservations.lockByOrderId.mock.invocationCallOrder[0]).toBeLessThan(
      reservations.insertActive.mock.invocationCallOrder[0]!,
    );
    expect(reservations.insertActive).toHaveBeenCalledWith(
      { orderId: ORDER_ID, productId: PRODUCT_A, quantity: 5 },
      expect.anything(),
    );
    expect(ledger.append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: InventoryLedgerType.RESERVE,
        quantity: 5,
        reservedDelta: 5,
        onHandDelta: 0,
        referenceType: InventoryLedgerReferenceType.ORDER,
        referenceId: ORDER_ID,
      }),
      expect.anything(),
    );
    expect(result).toEqual({
      orderId: ORDER_ID,
      lines: [
        {
          productId: PRODUCT_A,
          quantity: 5,
          status: InventoryReservationStatus.ACTIVE,
        },
      ],
    });
  });

  it('collects all shortages and writes nothing', async () => {
    balances.lockBalances.mockResolvedValue([
      balance({ productId: PRODUCT_A, onHand: 2, reserved: 0, available: 2 }),
      balance({ productId: PRODUCT_B, onHand: 4, reserved: 0, available: 4 }),
      balance({ productId: PRODUCT_C, onHand: 20, reserved: 0, available: 20 }),
    ]);
    reservations.lockByOrderId.mockResolvedValue([]);

    await expect(
      service.reserveForOrder({
        orderId: ORDER_ID,
        lines: [
          { productId: PRODUCT_A, quantity: 3 },
          { productId: PRODUCT_B, quantity: 5 },
          { productId: PRODUCT_C, quantity: 2 },
        ],
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toMatchObject({
      code: 'INVENTORY_INSUFFICIENT_STOCK',
      message: InventoryHttpMessage.INSUFFICIENT_STOCK,
      details: {
        lines: [
          { productId: PRODUCT_A, requested: 3 },
          { productId: PRODUCT_B, requested: 5 },
        ],
      },
    });

    expect(reservations.insertActive).not.toHaveBeenCalled();
    expect(balances.reserveQuantity).not.toHaveBeenCalled();
    expect(ledger.append).not.toHaveBeenCalled();
  });

  it('fails the whole reservation when any Inventory row is missing', async () => {
    balances.lockBalances.mockResolvedValue([
      balance({ productId: PRODUCT_A, available: 10 }),
    ]);
    reservations.lockByOrderId.mockResolvedValue([]);

    await expect(
      service.reserveForOrder({
        orderId: ORDER_ID,
        lines: [
          { productId: PRODUCT_A, quantity: 1 },
          { productId: PRODUCT_B, quantity: 1 },
        ],
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toBeInstanceOf(InventoryNotFoundError);
    expect(reservations.insertActive).not.toHaveBeenCalled();
  });

  it('replays the same order and payload without mutating again', async () => {
    const existing = reservation({ quantity: 2 });
    balances.lockBalances.mockResolvedValue([balance({ available: 8 })]);
    reservations.lockByOrderId.mockResolvedValue([existing]);

    const result = await service.reserveForOrder({
      orderId: ORDER_ID,
      lines: [{ productId: PRODUCT_A, quantity: 2 }],
      actor: SYSTEM_ACTOR,
    });

    expect(result.lines).toEqual([
      {
        productId: PRODUCT_A,
        quantity: 2,
        status: InventoryReservationStatus.ACTIVE,
      },
    ]);
    expect(reservations.insertActive).not.toHaveBeenCalled();
    expect(balances.reserveQuantity).not.toHaveBeenCalled();
    expect(ledger.append).not.toHaveBeenCalled();
  });

  it('conflicts when the same order retries a different payload', async () => {
    balances.lockBalances.mockResolvedValue([balance({ available: 8 })]);
    reservations.lockByOrderId.mockResolvedValue([
      reservation({ quantity: 2 }),
    ]);

    await expect(
      service.reserveForOrder({
        orderId: ORDER_ID,
        lines: [{ productId: PRODUCT_A, quantity: 3 }],
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toMatchObject({
      code: 'INVENTORY_RESERVATION_CONFLICT',
      message: InventoryHttpMessage.RESERVATION_CONFLICT,
    });
    expect(balances.reserveQuantity).not.toHaveBeenCalled();
  });

  it('conflicts on partial existing reservation state', async () => {
    balances.lockBalances.mockResolvedValue([
      balance({ productId: PRODUCT_A, available: 10 }),
      balance({ productId: PRODUCT_B, available: 10 }),
    ]);
    reservations.lockByOrderId.mockResolvedValue([
      reservation({ productId: PRODUCT_A, quantity: 1 }),
    ]);

    await expect(
      service.reserveForOrder({
        orderId: ORDER_ID,
        lines: [
          { productId: PRODUCT_A, quantity: 1 },
          { productId: PRODUCT_B, quantity: 1 },
        ],
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toBeInstanceOf(InventoryReservationConflictError);
    expect(reservations.insertActive).not.toHaveBeenCalled();
  });

  it('does not recreate ACTIVE rows from RELEASED or SHIPPED', async () => {
    balances.lockBalances.mockResolvedValue([balance({ available: 9 })]);
    reservations.lockByOrderId.mockResolvedValue([
      reservation({ status: InventoryReservationStatus.RELEASED }),
    ]);

    await expect(
      service.reserveForOrder({
        orderId: ORDER_ID,
        lines: [{ productId: PRODUCT_A, quantity: 1 }],
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toBeInstanceOf(InventoryReservationConflictError);
  });

  it('maps a USER actor and UUID correlation onto the RESERVE ledger', async () => {
    const row = reservation();
    balances.lockBalances.mockResolvedValue([balance({ available: 9 })]);
    reservations.lockByOrderId.mockResolvedValue([]);
    reservations.insertActive.mockResolvedValue({
      reservation: row,
      inserted: true,
    });
    balances.reserveQuantity.mockResolvedValue(
      balance({ reserved: 2, available: 8 }),
    );
    ledger.append.mockResolvedValue(ledgerEntry());

    await requestContext.run(
      { requestId: 'req_ignored', correlationId: CORRELATION_ID },
      async () => {
        await service.reserveForOrder({
          orderId: ORDER_ID,
          lines: [{ productId: PRODUCT_A, quantity: 1 }],
          actor: { type: InventoryLedgerActorType.USER, id: USER_ID },
        });
      },
    );

    expect(ledger.append).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: InventoryLedgerActorType.USER,
        actorId: USER_ID,
        correlationId: CORRELATION_ID,
      }),
      expect.anything(),
    );
  });

  it('joins a caller transaction and does not swallow reservation conflicts', async () => {
    balances.lockBalances.mockResolvedValue([balance({ available: 9 })]);
    reservations.lockByOrderId.mockResolvedValue([]);
    reservations.insertActive.mockRejectedValue(
      new InventoryReservationConflictError(),
    );

    await expect(
      service.reserveForOrder(
        {
          orderId: ORDER_ID,
          lines: [{ productId: PRODUCT_A, quantity: 1 }],
          actor: SYSTEM_ACTOR,
        },
        { [TRANSACTION_CONTEXT_BRAND]: true },
      ),
    ).rejects.toBeInstanceOf(InventoryReservationConflictError);
    expect(balances.reserveQuantity).not.toHaveBeenCalled();
  });

  it('releases every ACTIVE line in one transaction', async () => {
    const activeA = reservation({ productId: PRODUCT_A, quantity: 2 });
    const activeB = reservation({ productId: PRODUCT_B, quantity: 1 });
    reservations.findByOrderId.mockResolvedValue([activeA, activeB]);
    balances.lockBalances.mockResolvedValue([
      balance({ productId: PRODUCT_A, reserved: 2, available: 8 }),
      balance({ productId: PRODUCT_B, reserved: 1, available: 9 }),
    ]);
    reservations.lockByOrderId.mockResolvedValue([activeA, activeB]);
    reservations.transitionFromActive
      .mockResolvedValueOnce({
        reservation: {
          ...activeA,
          status: InventoryReservationStatus.RELEASED,
        },
        transitioned: true,
      })
      .mockResolvedValueOnce({
        reservation: {
          ...activeB,
          status: InventoryReservationStatus.RELEASED,
        },
        transitioned: true,
      });
    balances.releaseQuantity.mockResolvedValue(balance({ reserved: 0 }));
    ledger.append.mockResolvedValue(
      ledgerEntry({ type: InventoryLedgerType.RELEASE }),
    );

    const result = await service.releaseForOrder({
      orderId: ORDER_ID,
      actor: SYSTEM_ACTOR,
    });

    expect(balances.releaseQuantity).toHaveBeenCalledTimes(2);
    expect(ledger.append).toHaveBeenCalledTimes(2);
    expect(result.lines.map((line) => line.status)).toEqual([
      InventoryReservationStatus.RELEASED,
      InventoryReservationStatus.RELEASED,
    ]);
  });

  it('replays release when every row is already RELEASED', async () => {
    const released = reservation({
      status: InventoryReservationStatus.RELEASED,
    });
    reservations.findByOrderId.mockResolvedValue([released]);
    balances.lockBalances.mockResolvedValue([
      balance({ reserved: 0, available: 10 }),
    ]);
    reservations.lockByOrderId.mockResolvedValue([released]);

    const result = await service.releaseForOrder({
      orderId: ORDER_ID,
      actor: SYSTEM_ACTOR,
    });

    expect(result.lines[0]?.status).toBe(InventoryReservationStatus.RELEASED);
    expect(balances.releaseQuantity).not.toHaveBeenCalled();
    expect(ledger.append).not.toHaveBeenCalled();
  });

  it('conflicts release of SHIPPED or mixed reservation state', async () => {
    const shipped = reservation({ status: InventoryReservationStatus.SHIPPED });
    reservations.findByOrderId.mockResolvedValue([shipped]);
    balances.lockBalances.mockResolvedValue([balance()]);
    reservations.lockByOrderId.mockResolvedValue([shipped]);

    await expect(
      service.releaseForOrder({
        orderId: ORDER_ID,
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toBeInstanceOf(InventoryReservationConflictError);

    const active = reservation({ productId: PRODUCT_A });
    const released = reservation({
      productId: PRODUCT_B,
      status: InventoryReservationStatus.RELEASED,
    });
    reservations.findByOrderId.mockResolvedValue([active, released]);
    balances.lockBalances.mockResolvedValue([
      balance({ productId: PRODUCT_A }),
      balance({ productId: PRODUCT_B }),
    ]);
    reservations.lockByOrderId.mockResolvedValue([active, released]);

    await expect(
      service.releaseForOrder({
        orderId: ORDER_ID,
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toMatchObject({
      message: InventoryHttpMessage.RESERVATION_CONFLICT,
    });
    expect(balances.releaseQuantity).not.toHaveBeenCalled();
  });

  it('returns not found when the order has no reservation rows', async () => {
    reservations.findByOrderId.mockResolvedValue([]);

    await expect(
      service.releaseForOrder({
        orderId: ORDER_ID,
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toMatchObject({
      code: 'INVENTORY_RESERVATION_NOT_FOUND',
      message: InventoryHttpMessage.RESERVATION_NOT_FOUND,
    });
    expect(balances.lockBalances).not.toHaveBeenCalled();
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
      productId: PRODUCT_A,
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
      productId: PRODUCT_A,
      actor: SYSTEM_ACTOR,
    });

    expect(balances.shipQuantity).toHaveBeenCalledWith(
      PRODUCT_A,
      2,
      expect.anything(),
    );
  });

  it('ships every ACTIVE line in one transaction', async () => {
    const activeA = reservation({ productId: PRODUCT_A, quantity: 2 });
    const activeB = reservation({ productId: PRODUCT_B, quantity: 1 });
    reservations.findByOrderId.mockResolvedValue([activeA, activeB]);
    balances.lockBalances.mockResolvedValue([
      balance({ productId: PRODUCT_A, onHand: 10, reserved: 2, available: 8 }),
      balance({ productId: PRODUCT_B, onHand: 10, reserved: 1, available: 9 }),
    ]);
    reservations.lockByOrderId.mockResolvedValue([activeA, activeB]);
    reservations.transitionFromActive
      .mockResolvedValueOnce({
        reservation: {
          ...activeA,
          status: InventoryReservationStatus.SHIPPED,
        },
        transitioned: true,
      })
      .mockResolvedValueOnce({
        reservation: {
          ...activeB,
          status: InventoryReservationStatus.SHIPPED,
        },
        transitioned: true,
      });
    balances.shipQuantity.mockResolvedValue(
      balance({ onHand: 8, reserved: 0, available: 8 }),
    );
    ledger.append.mockResolvedValue(
      ledgerEntry({
        type: InventoryLedgerType.SHIP,
        onHandDelta: -2,
        reservedDelta: -2,
      }),
    );

    const result = await service.shipForOrder({
      orderId: ORDER_ID,
      actor: SYSTEM_ACTOR,
    });

    expect(
      reservations.lockOrderScope.mock.invocationCallOrder[0],
    ).toBeLessThan(balances.lockBalances.mock.invocationCallOrder[0]!);
    expect(balances.lockBalances.mock.invocationCallOrder[0]).toBeLessThan(
      reservations.lockByOrderId.mock.invocationCallOrder[0]!,
    );
    expect(balances.shipQuantity).toHaveBeenCalledTimes(2);
    expect(ledger.append).toHaveBeenCalledTimes(2);
    expect(ledger.append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: InventoryLedgerType.SHIP,
        referenceType: InventoryLedgerReferenceType.ORDER,
        referenceId: ORDER_ID,
      }),
      expect.anything(),
    );
    expect(result.lines.map((line) => line.status)).toEqual([
      InventoryReservationStatus.SHIPPED,
      InventoryReservationStatus.SHIPPED,
    ]);
  });

  it('replays ship when every row is already SHIPPED', async () => {
    const shipped = reservation({
      status: InventoryReservationStatus.SHIPPED,
    });
    reservations.findByOrderId.mockResolvedValue([shipped]);
    balances.lockBalances.mockResolvedValue([
      balance({ onHand: 8, reserved: 0, available: 8 }),
    ]);
    reservations.lockByOrderId.mockResolvedValue([shipped]);

    const result = await service.shipForOrder({
      orderId: ORDER_ID,
      actor: SYSTEM_ACTOR,
    });

    expect(result.lines[0]?.status).toBe(InventoryReservationStatus.SHIPPED);
    expect(balances.shipQuantity).not.toHaveBeenCalled();
    expect(ledger.append).not.toHaveBeenCalled();
  });

  it('conflicts ship of RELEASED or mixed reservation state', async () => {
    const released = reservation({
      status: InventoryReservationStatus.RELEASED,
    });
    reservations.findByOrderId.mockResolvedValue([released]);
    balances.lockBalances.mockResolvedValue([balance()]);
    reservations.lockByOrderId.mockResolvedValue([released]);

    await expect(
      service.shipForOrder({
        orderId: ORDER_ID,
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toMatchObject({
      code: 'INVENTORY_RESERVATION_CONFLICT',
      message: InventoryHttpMessage.SHIP_RESERVATION_CONFLICT,
    });

    const active = reservation({ productId: PRODUCT_A });
    const shipped = reservation({
      productId: PRODUCT_B,
      status: InventoryReservationStatus.SHIPPED,
    });
    reservations.findByOrderId.mockResolvedValue([active, shipped]);
    balances.lockBalances.mockResolvedValue([
      balance({ productId: PRODUCT_A }),
      balance({ productId: PRODUCT_B }),
    ]);
    reservations.lockByOrderId.mockResolvedValue([active, shipped]);

    await expect(
      service.shipForOrder({
        orderId: ORDER_ID,
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toMatchObject({
      message: InventoryHttpMessage.SHIP_RESERVATION_CONFLICT,
    });
    expect(balances.shipQuantity).not.toHaveBeenCalled();
  });

  it('returns not found when ship has no reservation rows', async () => {
    reservations.findByOrderId.mockResolvedValue([]);

    await expect(
      service.shipForOrder({
        orderId: ORDER_ID,
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toMatchObject({
      code: 'INVENTORY_RESERVATION_NOT_FOUND',
      message: InventoryHttpMessage.RESERVATION_NOT_FOUND,
    });
    expect(balances.lockBalances).not.toHaveBeenCalled();
  });

  it('maps ADMIN actor and UUID correlation onto the SHIP ledger', async () => {
    const active = reservation({ quantity: 2 });
    reservations.findByOrderId.mockResolvedValue([active]);
    balances.lockBalances.mockResolvedValue([
      balance({ onHand: 10, reserved: 2, available: 8 }),
    ]);
    reservations.lockByOrderId.mockResolvedValue([active]);
    reservations.transitionFromActive.mockResolvedValue({
      reservation: { ...active, status: InventoryReservationStatus.SHIPPED },
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

    await requestContext.run(
      { requestId: 'req_ignored', correlationId: CORRELATION_ID },
      async () => {
        await service.shipForOrder({
          orderId: ORDER_ID,
          actor: { type: InventoryLedgerActorType.ADMIN, id: USER_ID },
          correlationId: CORRELATION_ID,
        });
      },
    );

    expect(ledger.append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: InventoryLedgerType.SHIP,
        actorType: InventoryLedgerActorType.ADMIN,
        actorId: USER_ID,
        correlationId: CORRELATION_ID,
      }),
      expect.anything(),
    );
  });

  it('joins a caller transaction for ship and does not swallow conflicts', async () => {
    const active = reservation();
    reservations.findByOrderId.mockResolvedValue([active]);
    balances.lockBalances.mockResolvedValue([balance()]);
    reservations.lockByOrderId.mockResolvedValue([active]);
    reservations.transitionFromActive.mockResolvedValue({
      reservation: active,
      transitioned: false,
    });

    await expect(
      service.shipForOrder(
        {
          orderId: ORDER_ID,
          actor: SYSTEM_ACTOR,
        },
        { [TRANSACTION_CONTEXT_BRAND]: true },
      ),
    ).rejects.toBeInstanceOf(InventoryReservationConflictError);
    expect(balances.shipQuantity).not.toHaveBeenCalled();
  });

  it('inspects multi-SKU availability after locking, without writing', async () => {
    balances.lockBalances.mockResolvedValue([
      balance({ productId: PRODUCT_A, onHand: 2, reserved: 0, available: 2 }),
    ]);

    const result = await service.lockAndInspectAvailability({
      items: [{ productId: PRODUCT_A, quantity: 5 }],
      tx: { [TRANSACTION_CONTEXT_BRAND]: true },
    });

    expect(result.inspection.shortages).toEqual([
      { productId: PRODUCT_A, requested: 5, available: 2 },
    ]);
    expect(balances.reserveQuantity).not.toHaveBeenCalled();
  });
});

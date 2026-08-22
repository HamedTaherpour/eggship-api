import { randomUUID } from 'node:crypto';
import {
  TRANSACTION_CONTEXT_BRAND,
  type TransactionContext,
  TransactionRunner,
} from '../../../infrastructure/database/transaction';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import { AuthSubjectType } from '../../auth/domain/subject-type';
import type { InventoryBalance } from '../domain/inventory-balance';
import {
  InventoryCommandIdempotencyStatus,
  InventoryCommandOperation,
  hashReceivePayload,
} from '../domain/inventory-command-idempotency';
import {
  IdempotencyConflictError,
  InventoryInvalidAdjustmentError,
  InventoryInvalidQuantityError,
} from '../domain/inventory-errors';
import { InventoryHttpMessage } from '../domain/inventory-http-messages';
import {
  InventoryLedgerReferenceType,
  InventoryLedgerType,
  type InventoryLedgerEntry,
} from '../domain/inventory-ledger';
import type { InventoryCommandIdempotencyRepository } from '../infrastructure/inventory-command-idempotency.repository';
import type { InventoryService } from './inventory.service';
import { AdminInventoryOperationsService } from './admin-inventory-operations.service';

const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const IDEMPOTENCY_KEY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

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
}

function balance(overrides: Partial<InventoryBalance> = {}): InventoryBalance {
  const now = new Date('2026-08-22T00:00:00.000Z');
  return {
    productId: PRODUCT_ID,
    onHand: 10,
    reserved: 2,
    available: 8,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function ledger(
  overrides: Partial<InventoryLedgerEntry> = {},
): InventoryLedgerEntry {
  return {
    id: randomUUID(),
    productId: PRODUCT_ID,
    type: InventoryLedgerType.RECEIVE,
    quantity: 5,
    onHandDelta: 5,
    reservedDelta: 0,
    onHandAfter: 15,
    reservedAfter: 2,
    referenceType: InventoryLedgerReferenceType.RECEIVE,
    referenceId: IDEMPOTENCY_KEY,
    reason: null,
    actorType: 'ADMIN',
    actorId: ADMIN_ID,
    correlationId: IDEMPOTENCY_KEY,
    createdAt: new Date('2026-08-22T00:00:00.000Z'),
    ...overrides,
  };
}

const adminPrincipal: AuthenticatedPrincipal = {
  subjectId: ADMIN_ID,
  subjectType: AuthSubjectType.ADMIN,
  sessionId: randomUUID(),
};

describe('AdminInventoryOperationsService', () => {
  let inventory: jest.Mocked<
    Pick<InventoryService, 'getBalance' | 'receiveOnHand' | 'adjustOnHand'>
  >;
  let idempotency: jest.Mocked<
    Pick<
      InventoryCommandIdempotencyRepository,
      'findByKeyForUpdate' | 'insertPending' | 'markCompleted'
    >
  >;
  let logger: { info: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let service: AdminInventoryOperationsService;

  beforeEach(() => {
    inventory = {
      getBalance: jest.fn(),
      receiveOnHand: jest.fn(),
      adjustOnHand: jest.fn(),
    };
    idempotency = {
      findByKeyForUpdate: jest.fn(),
      insertPending: jest.fn(),
      markCompleted: jest.fn(),
    };
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service = new AdminInventoryOperationsService(
      new ImmediateTransactionRunner(),
      inventory as unknown as InventoryService,
      idempotency as unknown as InventoryCommandIdempotencyRepository,
      logger as never,
    );
  });

  it('returns current balance for getBalance', async () => {
    inventory.getBalance.mockResolvedValue(balance());
    await expect(service.getBalance(PRODUCT_ID)).resolves.toMatchObject({
      onHand: 10,
      available: 8,
    });
  });

  it('maps missing inventory to displayable not-found', async () => {
    inventory.getBalance.mockResolvedValue(null);
    await expect(service.getBalance(PRODUCT_ID)).rejects.toMatchObject({
      code: 'INVENTORY_NOT_FOUND',
      message: InventoryHttpMessage.NOT_FOUND,
    });
  });

  it('receives stock with admin actor and completes idempotency', async () => {
    idempotency.findByKeyForUpdate.mockResolvedValue(null);
    idempotency.insertPending.mockResolvedValue({
      id: randomUUID(),
      idempotencyKey: IDEMPOTENCY_KEY,
      operation: InventoryCommandOperation.RECEIVE,
      productId: PRODUCT_ID,
      payloadHash: 'hash',
      status: InventoryCommandIdempotencyStatus.PENDING,
      onHandAfter: null,
      reservedAfter: null,
      ledgerId: null,
      createdAt: new Date(),
    });
    inventory.receiveOnHand.mockResolvedValue({
      balance: balance({ onHand: 15, available: 13 }),
      ledger: ledger(),
    });

    const result = await service.receiveStock({
      productId: PRODUCT_ID,
      quantity: 5,
      idempotencyKey: IDEMPOTENCY_KEY,
      principal: adminPrincipal,
    });

    expect(result.onHand).toBe(15);
    expect(inventory.receiveOnHand).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: PRODUCT_ID,
        quantity: 5,
        referenceId: IDEMPOTENCY_KEY,
        actor: { type: 'ADMIN', id: ADMIN_ID },
      }),
      expect.objectContaining({ [TRANSACTION_CONTEXT_BRAND]: true }),
    );
    expect(idempotency.markCompleted).toHaveBeenCalled();
  });

  it('replays an identical receive without mutating stock twice', async () => {
    idempotency.findByKeyForUpdate.mockResolvedValue({
      id: randomUUID(),
      idempotencyKey: IDEMPOTENCY_KEY,
      operation: InventoryCommandOperation.RECEIVE,
      productId: PRODUCT_ID,
      payloadHash: hashReceivePayload({ productId: PRODUCT_ID, quantity: 5 }),
      status: InventoryCommandIdempotencyStatus.COMPLETED,
      onHandAfter: 15,
      reservedAfter: 2,
      ledgerId: randomUUID(),
      createdAt: new Date('2026-08-22T00:00:00.000Z'),
    });
    inventory.getBalance.mockResolvedValue(
      balance({ onHand: 15, reserved: 2, available: 13 }),
    );

    await service.receiveStock({
      productId: PRODUCT_ID,
      quantity: 5,
      idempotencyKey: IDEMPOTENCY_KEY,
      principal: adminPrincipal,
    });

    expect(inventory.receiveOnHand).not.toHaveBeenCalled();
  });

  it('rejects same idempotency key with different payload', async () => {
    idempotency.findByKeyForUpdate.mockResolvedValue({
      id: randomUUID(),
      idempotencyKey: IDEMPOTENCY_KEY,
      operation: InventoryCommandOperation.RECEIVE,
      productId: PRODUCT_ID,
      payloadHash: 'different-hash',
      status: InventoryCommandIdempotencyStatus.COMPLETED,
      onHandAfter: 15,
      reservedAfter: 2,
      ledgerId: randomUUID(),
      createdAt: new Date(),
    });

    await expect(
      service.receiveStock({
        productId: PRODUCT_ID,
        quantity: 5,
        idempotencyKey: IDEMPOTENCY_KEY,
        principal: adminPrincipal,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('requires a non-zero adjustment delta and reason', async () => {
    await expect(
      service.adjustStock({
        productId: PRODUCT_ID,
        delta: 0,
        reason: 'ignored',
        idempotencyKey: IDEMPOTENCY_KEY,
        principal: adminPrincipal,
      }),
    ).rejects.toBeInstanceOf(InventoryInvalidQuantityError);

    await expect(
      service.adjustStock({
        productId: PRODUCT_ID,
        delta: -1,
        reason: '   ',
        idempotencyKey: IDEMPOTENCY_KEY,
        principal: adminPrincipal,
      }),
    ).rejects.toMatchObject({
      code: 'INVENTORY_INVALID_ADJUSTMENT',
      message: InventoryHttpMessage.REASON_REQUIRED,
    });
  });

  it('maps invalid adjustment below reserved to displayable message', async () => {
    idempotency.findByKeyForUpdate.mockResolvedValue(null);
    idempotency.insertPending.mockResolvedValue({
      id: randomUUID(),
      idempotencyKey: IDEMPOTENCY_KEY,
      operation: InventoryCommandOperation.ADJUST,
      productId: PRODUCT_ID,
      payloadHash: 'hash',
      status: InventoryCommandIdempotencyStatus.PENDING,
      onHandAfter: null,
      reservedAfter: null,
      ledgerId: null,
      createdAt: new Date(),
    });
    inventory.adjustOnHand.mockRejectedValue(
      new InventoryInvalidAdjustmentError('internal'),
    );

    await expect(
      service.adjustStock({
        productId: PRODUCT_ID,
        delta: -4,
        reason: 'cycle count',
        idempotencyKey: IDEMPOTENCY_KEY,
        principal: adminPrincipal,
      }),
    ).rejects.toMatchObject({
      code: 'INVENTORY_INVALID_ADJUSTMENT',
      message: InventoryHttpMessage.INVALID_ADJUSTMENT,
    });
  });

  it('rejects non-admin principals at the application layer', async () => {
    await expect(
      service.receiveStock({
        productId: PRODUCT_ID,
        quantity: 1,
        idempotencyKey: IDEMPOTENCY_KEY,
        principal: {
          subjectId: 'user-1',
          subjectType: AuthSubjectType.USER,
          sessionId: randomUUID(),
        },
      }),
    ).rejects.toMatchObject({
      message: InventoryHttpMessage.ADMIN_REQUIRED,
    });
  });
});

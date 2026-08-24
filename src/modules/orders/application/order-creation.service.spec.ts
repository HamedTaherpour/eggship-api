import { randomUUID } from 'node:crypto';
import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import {
  TRANSACTION_CONTEXT_BRAND,
  TransactionRunner,
  type TransactionContext,
} from '../../../infrastructure/database/transaction';
import type { InventoryService } from '../../inventory/application/inventory.service';
import { InventoryInsufficientStockError } from '../../inventory/domain/inventory-errors';
import { InventoryLedgerActorType } from '../../inventory/domain/inventory-ledger';
import type { OrderPricingService } from '../../pricing/application/order-pricing.service';
import { DiscountTarget, DiscountType } from '../../pricing/domain/discount';
import type { OrderPricingSnapshot } from '../../pricing/domain/order-pricing';
import { OrderPricingProductUnavailableError } from '../../pricing/domain/order-pricing-errors';
import type { RegionRecord } from '../../regions/domain/region';
import type { RegionRepository } from '../../regions/infrastructure/region.repository';
import type { UserRecord } from '../../users/domain/user';
import type { UserRepository } from '../../users/infrastructure/user.repository';
import { OrderActorType } from '../domain/order-actor';
import { hashOrderCreatePayload } from '../domain/order-create-idempotency';
import type { OrderRecord } from '../domain/order';
import {
  OrderIdempotencyConflictError,
  OrderInvalidInputError,
  OrderInvalidProductError,
  OrderInvalidRegionError,
  OrderInvalidUserError,
} from '../domain/order-errors';
import { OrderStatus } from '../domain/order-status';
import type { OrderRepository } from '../infrastructure/order.repository';
import { OrderCreationService } from './order-creation.service';
import type { CreateOrderResult } from './order-creation.commands';

const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REGION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PRODUCT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRODUCT_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const IDEMPOTENCY_KEY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ORDER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const DISCOUNT_LINE = '11111111-1111-4111-8111-111111111111';
const DISCOUNT_ORDER = '22222222-2222-4222-8222-222222222222';
const EVALUATED_AT = new Date('2026-08-22T12:00:00.000Z');
const NOW = new Date('2026-08-22T12:00:01.000Z');

class ImmediateTransactionRunner extends TransactionRunner {
  isolationCalls = 0;

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
    this.isolationCalls += 1;
    return this.run(fn);
  }
}

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: USER_ID,
    phone: '+989121234567',
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function region(overrides: Partial<RegionRecord> = {}): RegionRecord {
  return {
    id: REGION_ID,
    name: 'Tehran North',
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function pricingSnapshot(
  overrides: Partial<OrderPricingSnapshot> = {},
): OrderPricingSnapshot {
  const lines = overrides.lines ?? [
    {
      productId: PRODUCT_A,
      productName: 'Fresh eggs',
      categoryId: '99999999-9999-4999-8999-999999999999',
      unitPrice: 10_000,
      quantity: 2,
      grossLineTotal: 20_000n,
      lineDiscountAmount: 0n,
      finalLineTotal: 20_000n,
      appliedLineDiscount: null,
    },
  ];
  const grossSubtotal =
    overrides.grossSubtotal ??
    lines.reduce((sum, line) => sum + line.grossLineTotal, 0n);
  const lineDiscountTotal =
    overrides.lineDiscountTotal ??
    lines.reduce((sum, line) => sum + line.lineDiscountAmount, 0n);
  const subtotalAfterLineDiscounts =
    overrides.subtotalAfterLineDiscounts ??
    lines.reduce((sum, line) => sum + line.finalLineTotal, 0n);
  const orderDiscountAmount = overrides.orderDiscountAmount ?? 0n;
  return {
    evaluatedAt: overrides.evaluatedAt ?? EVALUATED_AT,
    lines,
    grossSubtotal,
    lineDiscountTotal,
    subtotalAfterLineDiscounts,
    orderDiscountAmount,
    total: overrides.total ?? subtotalAfterLineDiscounts - orderDiscountAmount,
    appliedOrderDiscount: overrides.appliedOrderDiscount ?? null,
  };
}

function orderFromSnapshot(
  priced: OrderPricingSnapshot,
  overrides: Partial<OrderRecord> = {},
): OrderRecord {
  const payloadHash = hashOrderCreatePayload({
    regionId: REGION_ID,
    lines: priced.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
    })),
  });
  return {
    id: ORDER_ID,
    userId: USER_ID,
    status: OrderStatus.PENDING_REVIEW,
    customerPhone: '+989121234567',
    regionId: REGION_ID,
    regionName: 'Tehran North',
    grossSubtotal: priced.grossSubtotal,
    lineDiscountTotal: priced.lineDiscountTotal,
    subtotalAfterLineDiscounts: priced.subtotalAfterLineDiscounts,
    orderDiscountAmount: priced.orderDiscountAmount,
    total: priced.total,
    pricingEvaluatedAt: priced.evaluatedAt,
    appliedOrderDiscount: priced.appliedOrderDiscount,
    idempotencyKey: IDEMPOTENCY_KEY,
    idempotencyPayloadHash: payloadHash,
    deliveryAt: null,
    confirmedAt: null,
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    lines: priced.lines.map((line) => ({
      id: randomUUID(),
      orderId: ORDER_ID,
      productId: line.productId,
      productName: line.productName,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      grossLineTotal: line.grossLineTotal,
      lineDiscountAmount: line.lineDiscountAmount,
      finalLineTotal: line.finalLineTotal,
      appliedLineDiscount: line.appliedLineDiscount,
      createdAt: NOW,
    })),
    ...overrides,
  };
}

describe('OrderCreationService', () => {
  let transactions: ImmediateTransactionRunner;
  let orders: jest.Mocked<
    Pick<
      OrderRepository,
      | 'lockCreateIdempotencyScope'
      | 'findByUserIdAndIdempotencyKey'
      | 'createWithTrustedSnapshots'
    >
  >;
  let pricing: jest.Mocked<Pick<OrderPricingService, 'priceOrderLines'>>;
  let inventory: jest.Mocked<Pick<InventoryService, 'reserveForOrder'>>;
  let users: jest.Mocked<Pick<UserRepository, 'findById'>>;
  let regions: jest.Mocked<Pick<RegionRepository, 'findById'>>;
  let logger: jest.Mocked<Pick<ApplicationLogger, 'info'>>;
  let service: OrderCreationService;

  beforeEach(() => {
    transactions = new ImmediateTransactionRunner();
    orders = {
      lockCreateIdempotencyScope: jest.fn().mockResolvedValue(undefined),
      findByUserIdAndIdempotencyKey: jest.fn().mockResolvedValue(null),
      createWithTrustedSnapshots: jest.fn(),
    };
    pricing = { priceOrderLines: jest.fn() };
    inventory = {
      reserveForOrder: jest.fn().mockResolvedValue({
        orderId: ORDER_ID,
        lines: [],
      }),
    };
    users = { findById: jest.fn().mockResolvedValue(user()) };
    regions = { findById: jest.fn().mockResolvedValue(region()) };
    logger = { info: jest.fn() };
    service = new OrderCreationService(
      transactions,
      orders as unknown as OrderRepository,
      pricing as unknown as OrderPricingService,
      inventory as unknown as InventoryService,
      users as unknown as UserRepository,
      regions as unknown as RegionRepository,
      logger as unknown as ApplicationLogger,
    );
  });

  async function create(
    lines: Array<{ productId: string; quantity: number }> = [
      { productId: PRODUCT_A, quantity: 2 },
    ],
  ): Promise<CreateOrderResult> {
    return service.createOrder({
      actor: { type: OrderActorType.USER, id: USER_ID },
      regionId: REGION_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      lines,
    });
  }

  it('creates a no-discount order under REPEATABLE READ and reserves stock', async () => {
    const priced = pricingSnapshot();
    pricing.priceOrderLines.mockResolvedValue(priced);
    const created = orderFromSnapshot(priced);
    orders.createWithTrustedSnapshots.mockResolvedValue(created);

    const result = await create();

    expect(transactions.isolationCalls).toBe(1);
    expect(orders.lockCreateIdempotencyScope).toHaveBeenCalledWith(
      USER_ID,
      IDEMPOTENCY_KEY,
      expect.anything(),
    );
    expect(pricing.priceOrderLines).toHaveBeenCalledTimes(1);
    expect(pricing.priceOrderLines.mock.calls[0]![0]).toEqual([
      { productId: PRODUCT_A, quantity: 2 },
    ]);
    expect(pricing.priceOrderLines.mock.calls[0]![1]).toEqual(
      expect.objectContaining({
        tx: { [TRANSACTION_CONTEXT_BRAND]: true },
      }),
    );
    expect(orders.createWithTrustedSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        customerPhone: '+989121234567',
        regionId: REGION_ID,
        regionName: 'Tehran North',
        grossSubtotal: 20_000n,
        total: 20_000n,
        pricingEvaluatedAt: EVALUATED_AT,
        appliedOrderDiscount: null,
      }),
      expect.anything(),
    );
    expect(inventory.reserveForOrder).toHaveBeenCalledWith(
      {
        orderId: ORDER_ID,
        lines: [{ productId: PRODUCT_A, quantity: 2 }],
        actor: { type: InventoryLedgerActorType.USER, id: USER_ID },
      },
      expect.anything(),
    );
    expect(result).toEqual({ order: created, created: true });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'order.created',
        orderId: created.id,
      }),
      'Order created with inventory reservation',
    );
  });

  it('logs order.created once only after a serialization retry commits', async () => {
    const priced = pricingSnapshot();
    const created = orderFromSnapshot(priced);
    pricing.priceOrderLines.mockResolvedValue(priced);
    orders.createWithTrustedSnapshots.mockResolvedValue(created);
    let transactionAttempt = 0;
    jest
      .spyOn(transactions, 'runRepeatableRead')
      .mockImplementation(async (fn) => {
        transactionAttempt += 1;
        const result = await fn({ [TRANSACTION_CONTEXT_BRAND]: true });
        if (transactionAttempt === 1) {
          throw Object.assign(new Error('serialization failure'), {
            code: 'P2034',
          });
        }
        return result;
      });

    await expect(create()).resolves.toEqual({ order: created, created: true });

    expect(transactionAttempt).toBe(2);
    expect(
      logger.info.mock.calls.filter(
        ([fields]) => fields.operation === 'order.created',
      ),
    ).toHaveLength(1);
  });

  it('does not retry errors that only mention a serialization code in text', async () => {
    const error = new Error('upstream context mentioned 40001');
    pricing.priceOrderLines.mockRejectedValue(error);

    await expect(create()).rejects.toBe(error);

    expect(transactions.isolationCalls).toBe(1);
  });

  it('retries the Prisma adapter PostgreSQL serialization metadata shape', async () => {
    const priced = pricingSnapshot();
    const created = orderFromSnapshot(priced);
    pricing.priceOrderLines.mockResolvedValue(priced);
    orders.createWithTrustedSnapshots.mockResolvedValue(created);
    let transactionAttempt = 0;
    jest
      .spyOn(transactions, 'runRepeatableRead')
      .mockImplementation(async (fn) => {
        transactionAttempt += 1;
        const result = await fn({ [TRANSACTION_CONTEXT_BRAND]: true });
        if (transactionAttempt === 1) {
          throw Object.assign(new Error('adapter serialization failure'), {
            code: 'P2010',
            meta: {
              driverAdapterError: {
                cause: {
                  originalCode: '40001',
                  kind: 'TransactionWriteConflict',
                },
              },
            },
          });
        }
        return result;
      });

    await expect(create()).resolves.toEqual({ order: created, created: true });
    expect(transactionAttempt).toBe(2);
  });

  it('bounds serialization retries to five transaction attempts', async () => {
    const failure = Object.assign(new Error('serialization failure'), {
      code: 'P2034',
    });
    pricing.priceOrderLines.mockRejectedValue(failure);

    await expect(create()).rejects.toBeInstanceOf(OrderInvalidInputError);

    expect(transactions.isolationCalls).toBe(5);
    expect(
      logger.info.mock.calls.filter(
        ([fields]) => fields.operation === 'order.create.serialization_retry',
      ),
    ).toHaveLength(4);
    expect(
      logger.info.mock.calls.filter(
        ([fields]) => fields.operation === 'order.created',
      ),
    ).toHaveLength(0);
  });

  it('persists LINE discount snapshots from PRC-05', async () => {
    const priced = pricingSnapshot({
      lines: [
        {
          productId: PRODUCT_A,
          productName: 'Fresh eggs',
          categoryId: '99999999-9999-4999-8999-999999999999',
          unitPrice: 10_000,
          quantity: 2,
          grossLineTotal: 20_000n,
          lineDiscountAmount: 2_000n,
          finalLineTotal: 18_000n,
          appliedLineDiscount: {
            discountId: DISCOUNT_LINE,
            name: 'Line 10%',
            type: DiscountType.PERCENT,
            target: DiscountTarget.PRODUCT,
            percentValue: 10,
            fixedAmount: null,
            precedence: 10,
            productId: PRODUCT_A,
            categoryId: null,
          },
        },
      ],
      lineDiscountTotal: 2_000n,
      subtotalAfterLineDiscounts: 18_000n,
      total: 18_000n,
    });
    pricing.priceOrderLines.mockResolvedValue(priced);
    orders.createWithTrustedSnapshots.mockResolvedValue(
      orderFromSnapshot(priced),
    );

    await create();

    const persisted = orders.createWithTrustedSnapshots.mock.calls[0]![0];
    expect(persisted.lineDiscountTotal).toBe(2_000n);
    expect(persisted.subtotalAfterLineDiscounts).toBe(18_000n);
    expect(persisted.lines[0]).toMatchObject({
      lineDiscountAmount: 2_000n,
      finalLineTotal: 18_000n,
    });
    expect(persisted.lines[0]!.appliedLineDiscount).toMatchObject({
      discountId: DISCOUNT_LINE,
    });
  });

  it('persists ORDER discount snapshots from PRC-05', async () => {
    const priced = pricingSnapshot({
      orderDiscountAmount: 1_000n,
      total: 19_000n,
      appliedOrderDiscount: {
        discountId: DISCOUNT_ORDER,
        name: 'Order fixed',
        type: DiscountType.FIXED,
        target: DiscountTarget.ORDER,
        percentValue: null,
        fixedAmount: 1_000,
        precedence: 5,
        productId: null,
        categoryId: null,
      },
    });
    pricing.priceOrderLines.mockResolvedValue(priced);
    orders.createWithTrustedSnapshots.mockResolvedValue(
      orderFromSnapshot(priced),
    );

    await create();

    const persisted = orders.createWithTrustedSnapshots.mock.calls[0]![0];
    expect(persisted.orderDiscountAmount).toBe(1_000n);
    expect(persisted.total).toBe(19_000n);
    expect(persisted.appliedOrderDiscount).toMatchObject({
      discountId: DISCOUNT_ORDER,
      target: DiscountTarget.ORDER,
    });
  });

  it('persists LINE + ORDER composition from one evaluatedAt', async () => {
    const priced = pricingSnapshot({
      lines: [
        {
          productId: PRODUCT_A,
          productName: 'Fresh eggs',
          categoryId: '99999999-9999-4999-8999-999999999999',
          unitPrice: 10_000,
          quantity: 2,
          grossLineTotal: 20_000n,
          lineDiscountAmount: 2_000n,
          finalLineTotal: 18_000n,
          appliedLineDiscount: {
            discountId: DISCOUNT_LINE,
            name: 'Line 10%',
            type: DiscountType.PERCENT,
            target: DiscountTarget.PRODUCT,
            percentValue: 10,
            fixedAmount: null,
            precedence: 10,
            productId: PRODUCT_A,
            categoryId: null,
          },
        },
      ],
      lineDiscountTotal: 2_000n,
      subtotalAfterLineDiscounts: 18_000n,
      orderDiscountAmount: 1_800n,
      total: 16_200n,
      appliedOrderDiscount: {
        discountId: DISCOUNT_ORDER,
        name: 'Order 10%',
        type: DiscountType.PERCENT,
        target: DiscountTarget.ORDER,
        percentValue: 10,
        fixedAmount: null,
        precedence: 1,
        productId: null,
        categoryId: null,
      },
    });
    pricing.priceOrderLines.mockResolvedValue(priced);
    orders.createWithTrustedSnapshots.mockResolvedValue(
      orderFromSnapshot(priced),
    );

    const result = await create();

    expect(result.order.pricingEvaluatedAt).toEqual(EVALUATED_AT);
    expect(result.order.total).toBe(16_200n);
  });

  it('collapses duplicate product lines before pricing and reservation', async () => {
    const priced = pricingSnapshot({
      lines: [
        {
          productId: PRODUCT_A,
          productName: 'Fresh eggs',
          categoryId: '99999999-9999-4999-8999-999999999999',
          unitPrice: 10_000,
          quantity: 5,
          grossLineTotal: 50_000n,
          lineDiscountAmount: 0n,
          finalLineTotal: 50_000n,
          appliedLineDiscount: null,
        },
      ],
      grossSubtotal: 50_000n,
      subtotalAfterLineDiscounts: 50_000n,
      total: 50_000n,
    });
    pricing.priceOrderLines.mockResolvedValue(priced);
    orders.createWithTrustedSnapshots.mockResolvedValue(
      orderFromSnapshot(priced),
    );

    await create([
      { productId: PRODUCT_A, quantity: 2 },
      { productId: PRODUCT_A, quantity: 3 },
    ]);

    expect(pricing.priceOrderLines).toHaveBeenCalledWith(
      [{ productId: PRODUCT_A, quantity: 5 }],
      expect.anything(),
    );
    expect(inventory.reserveForOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [{ productId: PRODUCT_A, quantity: 5 }],
      }),
      expect.anything(),
    );
  });

  it('maps unavailable products to ORDER_INVALID_PRODUCT', async () => {
    pricing.priceOrderLines.mockRejectedValue(
      new OrderPricingProductUnavailableError(),
    );

    await expect(create()).rejects.toBeInstanceOf(OrderInvalidProductError);
    expect(orders.createWithTrustedSnapshots).not.toHaveBeenCalled();
    expect(inventory.reserveForOrder).not.toHaveBeenCalled();
  });

  it('rejects invalid quantities before opening the create transaction', async () => {
    await expect(
      create([{ productId: PRODUCT_A, quantity: 0 }]),
    ).rejects.toBeInstanceOf(OrderInvalidInputError);
    expect(transactions.isolationCalls).toBe(0);
  });

  it('rolls back when inventory is insufficient (no create after failed reserve path)', async () => {
    const priced = pricingSnapshot();
    pricing.priceOrderLines.mockResolvedValue(priced);
    orders.createWithTrustedSnapshots.mockResolvedValue(
      orderFromSnapshot(priced),
    );
    inventory.reserveForOrder.mockRejectedValue(
      new InventoryInsufficientStockError('موجودی کافی نیست.', {
        lines: [{ productId: PRODUCT_A, requested: 2 }],
      }),
    );

    await expect(create()).rejects.toBeInstanceOf(
      InventoryInsufficientStockError,
    );
  });

  it('rolls back when pricing fails before persistence', async () => {
    pricing.priceOrderLines.mockRejectedValue(
      new OrderPricingProductUnavailableError(),
    );

    await expect(create()).rejects.toBeInstanceOf(OrderInvalidProductError);
    expect(orders.createWithTrustedSnapshots).not.toHaveBeenCalled();
  });

  it('rolls back when reservation fails after create in the same tx', async () => {
    const priced = pricingSnapshot();
    pricing.priceOrderLines.mockResolvedValue(priced);
    orders.createWithTrustedSnapshots.mockResolvedValue(
      orderFromSnapshot(priced),
    );
    inventory.reserveForOrder.mockRejectedValue(new Error('reserve failed'));

    await expect(create()).rejects.toThrow('reserve failed');
  });

  it('replays identical idempotent creates without reserving again', async () => {
    const priced = pricingSnapshot();
    const existing = orderFromSnapshot(priced);
    orders.findByUserIdAndIdempotencyKey.mockResolvedValue(existing);

    const result = await create();

    expect(result).toEqual({ order: existing, created: false });
    expect(pricing.priceOrderLines).not.toHaveBeenCalled();
    expect(orders.createWithTrustedSnapshots).not.toHaveBeenCalled();
    expect(inventory.reserveForOrder).not.toHaveBeenCalled();
  });

  it('recovers a structured unique race only when a fresh lookup finds the order', async () => {
    const priced = pricingSnapshot();
    const existing = orderFromSnapshot(priced);
    const uniqueFailure = { code: 'P2002' };
    pricing.priceOrderLines.mockResolvedValue(priced);
    orders.createWithTrustedSnapshots.mockRejectedValue(uniqueFailure);
    orders.findByUserIdAndIdempotencyKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);

    await expect(create()).resolves.toEqual({
      order: existing,
      created: false,
    });
    expect(transactions.isolationCalls).toBe(1);
    expect(inventory.reserveForOrder).not.toHaveBeenCalled();
  });

  it('rethrows a structured unique failure when no idempotent order committed', async () => {
    const priced = pricingSnapshot();
    const uniqueFailure = { code: '23505' };
    pricing.priceOrderLines.mockResolvedValue(priced);
    orders.createWithTrustedSnapshots.mockRejectedValue(uniqueFailure);

    await expect(create()).rejects.toBe(uniqueFailure);

    expect(transactions.isolationCalls).toBe(1);
    expect(orders.findByUserIdAndIdempotencyKey).toHaveBeenCalledTimes(2);
    expect(inventory.reserveForOrder).not.toHaveBeenCalled();
  });

  it('preserves the original unique failure if the proof lookup fails', async () => {
    const priced = pricingSnapshot();
    const uniqueFailure = { code: 'P2002' };
    pricing.priceOrderLines.mockResolvedValue(priced);
    orders.createWithTrustedSnapshots.mockRejectedValue(uniqueFailure);
    orders.findByUserIdAndIdempotencyKey
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('lookup unavailable'));

    await expect(create()).rejects.toBe(uniqueFailure);

    expect(transactions.isolationCalls).toBe(1);
  });

  it('conflicts when the same idempotency key has a different payload', async () => {
    const priced = pricingSnapshot();
    const existing = orderFromSnapshot(priced, {
      idempotencyPayloadHash: 'a'.repeat(64),
    });
    orders.findByUserIdAndIdempotencyKey.mockResolvedValue(existing);

    await expect(create()).rejects.toBeInstanceOf(
      OrderIdempotencyConflictError,
    );
    expect(inventory.reserveForOrder).not.toHaveBeenCalled();
  });

  it('rejects inactive users and missing/inactive regions', async () => {
    users.findById.mockResolvedValue(user({ isActive: false }));
    pricing.priceOrderLines.mockResolvedValue(pricingSnapshot());

    await expect(create()).rejects.toBeInstanceOf(OrderInvalidUserError);

    users.findById.mockResolvedValue(user());
    regions.findById.mockResolvedValue(null);
    await expect(create()).rejects.toBeInstanceOf(OrderInvalidRegionError);

    regions.findById.mockResolvedValue(region({ isActive: false }));
    await expect(create()).rejects.toBeInstanceOf(OrderInvalidRegionError);
  });

  it('rejects non-USER actors', async () => {
    await expect(
      service.createOrder({
        actor: { type: OrderActorType.ADMIN, id: USER_ID } as never,
        regionId: REGION_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        lines: [{ productId: PRODUCT_A, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(OrderInvalidInputError);
  });

  it('passes collapsed multi-SKU lines to pricing and inventory in the same order', async () => {
    const priced = pricingSnapshot({
      lines: [
        {
          productId: PRODUCT_A,
          productName: 'A',
          categoryId: '99999999-9999-4999-8999-999999999999',
          unitPrice: 1_000,
          quantity: 1,
          grossLineTotal: 1_000n,
          lineDiscountAmount: 0n,
          finalLineTotal: 1_000n,
          appliedLineDiscount: null,
        },
        {
          productId: PRODUCT_B,
          productName: 'B',
          categoryId: '99999999-9999-4999-8999-999999999999',
          unitPrice: 2_000,
          quantity: 3,
          grossLineTotal: 6_000n,
          lineDiscountAmount: 0n,
          finalLineTotal: 6_000n,
          appliedLineDiscount: null,
        },
      ],
      grossSubtotal: 7_000n,
      subtotalAfterLineDiscounts: 7_000n,
      total: 7_000n,
    });
    pricing.priceOrderLines.mockResolvedValue(priced);
    orders.createWithTrustedSnapshots.mockResolvedValue(
      orderFromSnapshot(priced),
    );

    await create([
      { productId: PRODUCT_B, quantity: 3 },
      { productId: PRODUCT_A, quantity: 1 },
    ]);

    const pricedLines = pricing.priceOrderLines.mock.calls[0]![0];
    const reservedLines = inventory.reserveForOrder.mock.calls[0]![0].lines;
    expect(pricedLines).toEqual(reservedLines);
  });
});

import { randomUUID } from 'node:crypto';
import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import {
  TRANSACTION_CONTEXT_BRAND,
  TransactionRunner,
  type TransactionContext,
} from '../../../infrastructure/database/transaction';
import type { InventoryService } from '../../inventory/application/inventory.service';
import {
  InventoryReservationConflictError,
  InventoryReservationNotFoundError,
} from '../../inventory/domain/inventory-errors';
import { InventoryLedgerActorType } from '../../inventory/domain/inventory-ledger';
import type { DiscountUsageService } from '../../pricing/application/discount-usage.service';
import { OrderActorType } from '../domain/order-actor';
import type { OrderRecord } from '../domain/order';
import {
  OrderCancellationReasonRequiredError,
  OrderInvalidInputError,
  OrderInvalidTransitionError,
  OrderNotFoundError,
} from '../domain/order-errors';
import { OrderMessage } from '../domain/order-messages';
import { OrderStatus } from '../domain/order-status';
import type { OrderRepository } from '../infrastructure/order.repository';
import { OrderTransitionService } from './order-transition.service';

const ORDER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NOW = new Date('2026-08-22T10:00:00.000Z');
const CONFIRMED_AT = new Date('2026-08-22T10:05:00.000Z');
const DELIVERY_AT = new Date('2026-08-23T09:00:00.000Z');
const OTHER_DELIVERY_AT = new Date('2026-08-24T09:00:00.000Z');

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

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: ORDER_ID,
    userId: USER_ID,
    status: OrderStatus.PENDING_REVIEW,
    customerPhone: '+989121234567',
    regionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    regionName: 'Tehran',
    grossSubtotal: 2000n,
    lineDiscountTotal: 0n,
    subtotalAfterLineDiscounts: 2000n,
    orderDiscountAmount: 0n,
    total: 2000n,
    pricingEvaluatedAt: NOW,
    commercePolicyRevision: 1,
    appliedOrderDiscount: null,
    idempotencyKey: null,
    idempotencyPayloadHash: null,
    deliveryAt: null,
    confirmedAt: null,
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    lines: [
      {
        id: randomUUID(),
        orderId: ORDER_ID,
        productId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        productName: 'Eggs',
        unitPrice: 1000,
        quantity: 2,
        discountedQuantity: 0,
        grossLineTotal: 2000n,
        lineDiscountAmount: 0n,
        finalLineTotal: 2000n,
        appliedLineDiscount: null,
        createdAt: NOW,
      },
    ],
    ...overrides,
  };
}

describe('OrderTransitionService', () => {
  let repository: jest.Mocked<
    Pick<
      OrderRepository,
      | 'findById'
      | 'findOwnedById'
      | 'transitionPendingToConfirmed'
      | 'transitionPendingToCancelled'
      | 'transitionPendingToCancelledForOwner'
      | 'transitionConfirmedToCancelled'
      | 'transitionConfirmedToShipped'
      | 'transitionShippedToDelivered'
    >
  >;
  let discountUsage: jest.Mocked<
    Pick<
      DiscountUsageService,
      'lockRemainingForPricing' | 'consumeForOrder' | 'releaseForOrder'
    >
  >;
  let inventory: jest.Mocked<
    Pick<InventoryService, 'releaseForOrder' | 'shipForOrder'>
  >;
  let logger: jest.Mocked<Pick<ApplicationLogger, 'info' | 'warn'>>;
  let service: OrderTransitionService;

  const admin = { type: OrderActorType.ADMIN, id: ADMIN_ID } as const;
  const customer = { type: OrderActorType.USER, id: USER_ID } as const;

  beforeEach(() => {
    repository = {
      findById: jest.fn(),
      findOwnedById: jest.fn(),
      transitionPendingToConfirmed: jest.fn(),
      transitionPendingToCancelled: jest.fn(),
      transitionPendingToCancelledForOwner: jest.fn(),
      transitionConfirmedToCancelled: jest.fn(),
      transitionConfirmedToShipped: jest.fn(),
      transitionShippedToDelivered: jest.fn(),
    };
    discountUsage = {
      lockRemainingForPricing: jest.fn().mockResolvedValue(new Map()),
      consumeForOrder: jest.fn().mockResolvedValue(undefined),
      releaseForOrder: jest.fn().mockResolvedValue(undefined),
    };
    inventory = {
      releaseForOrder: jest.fn(),
      shipForOrder: jest.fn(),
    };
    logger = { info: jest.fn(), warn: jest.fn() };
    service = new OrderTransitionService(
      new ImmediateTransactionRunner(),
      repository as unknown as OrderRepository,
      discountUsage as unknown as DiscountUsageService,
      inventory as unknown as InventoryService,
      logger as unknown as ApplicationLogger,
    );
  });

  describe('confirmOrder', () => {
    it('confirms PENDING_REVIEW without calling Inventory', async () => {
      const confirmed = order({
        status: OrderStatus.CONFIRMED,
        confirmedAt: CONFIRMED_AT,
      });
      repository.transitionPendingToConfirmed.mockResolvedValue(confirmed);

      const result = await service.confirmOrder({
        orderId: ORDER_ID,
        actor: admin,
      });

      expect(result).toEqual({ order: confirmed, replay: false });
      expect(inventory.releaseForOrder).not.toHaveBeenCalled();
      expect(inventory.shipForOrder).not.toHaveBeenCalled();
    });

    it('persists deliveryAt on the first successful confirm', async () => {
      repository.transitionPendingToConfirmed.mockResolvedValue(
        order({
          status: OrderStatus.CONFIRMED,
          confirmedAt: CONFIRMED_AT,
          deliveryAt: DELIVERY_AT,
        }),
      );

      await service.confirmOrder({
        orderId: ORDER_ID,
        actor: admin,
        deliveryAt: DELIVERY_AT,
      });

      expect(repository.transitionPendingToConfirmed).toHaveBeenCalledWith(
        ORDER_ID,
        { deliveryAt: DELIVERY_AT },
        expect.anything(),
      );
    });

    it('replays CONFIRMED without rewriting deliveryAt or calling Inventory', async () => {
      const existing = order({
        status: OrderStatus.CONFIRMED,
        confirmedAt: CONFIRMED_AT,
        deliveryAt: DELIVERY_AT,
      });
      repository.transitionPendingToConfirmed.mockResolvedValue(null);
      repository.findById.mockResolvedValue(existing);

      const result = await service.confirmOrder({
        orderId: ORDER_ID,
        actor: admin,
        deliveryAt: OTHER_DELIVERY_AT,
      });

      expect(result).toEqual({ order: existing, replay: true });
      expect(result.order.deliveryAt).toEqual(DELIVERY_AT);
      expect(result.order.confirmedAt).toEqual(CONFIRMED_AT);
      expect(inventory.shipForOrder).not.toHaveBeenCalled();
    });

    it('rejects confirm from an incompatible status', async () => {
      repository.transitionPendingToConfirmed.mockResolvedValue(null);
      repository.findById.mockResolvedValue(
        order({ status: OrderStatus.CANCELLED, cancelledAt: NOW }),
      );

      await expect(
        service.confirmOrder({ orderId: ORDER_ID, actor: admin }),
      ).rejects.toMatchObject({
        code: 'ORDER_INVALID_TRANSITION',
        message: OrderMessage.INVALID_TRANSITION,
      });
    });

    it('rejects a customer actor', async () => {
      await expect(
        service.confirmOrder({
          orderId: ORDER_ID,
          actor: customer as unknown as typeof admin,
        }),
      ).rejects.toBeInstanceOf(OrderInvalidInputError);
    });
  });

  describe('cancelPendingOrderByCustomer', () => {
    it('cancels PENDING_REVIEW, persists a null reason, and releases inventory', async () => {
      const cancelled = order({
        status: OrderStatus.CANCELLED,
        cancelledAt: NOW,
        cancelReason: null,
      });
      repository.transitionPendingToCancelledForOwner.mockResolvedValue(
        cancelled,
      );
      inventory.releaseForOrder.mockResolvedValue({
        orderId: ORDER_ID,
        lines: [],
      });

      const result = await service.cancelPendingOrderByCustomer({
        orderId: ORDER_ID,
        actor: customer,
      });

      expect(result.order.cancelReason).toBeNull();
      expect(result.replay).toBe(false);
      expect(
        repository.transitionPendingToCancelledForOwner,
      ).toHaveBeenCalledWith(ORDER_ID, USER_ID, expect.anything());
      expect(repository.transitionConfirmedToCancelled).not.toHaveBeenCalled();
      expect(discountUsage.releaseForOrder).toHaveBeenCalledWith(
        { orderId: ORDER_ID, userId: USER_ID },
        expect.anything(),
      );
      expect(inventory.releaseForOrder).toHaveBeenCalledWith(
        {
          orderId: ORDER_ID,
          actor: { type: InventoryLedgerActorType.USER, id: USER_ID },
        },
        expect.anything(),
      );
      expect(
        discountUsage.releaseForOrder.mock.invocationCallOrder[0],
      ).toBeLessThan(inventory.releaseForOrder.mock.invocationCallOrder[0]!);
    });

    it('rejects customer cancel of CONFIRMED without calling Inventory', async () => {
      repository.transitionPendingToCancelledForOwner.mockResolvedValue(null);
      repository.findOwnedById.mockResolvedValue(
        order({
          status: OrderStatus.CONFIRMED,
          confirmedAt: CONFIRMED_AT,
        }),
      );

      await expect(
        service.cancelPendingOrderByCustomer({
          orderId: ORDER_ID,
          actor: customer,
        }),
      ).rejects.toMatchObject({
        code: 'ORDER_INVALID_TRANSITION',
        message: OrderMessage.CUSTOMER_CANCEL_DENIED,
      });
      expect(inventory.releaseForOrder).not.toHaveBeenCalled();
      expect(discountUsage.releaseForOrder).not.toHaveBeenCalled();
    });

    it('replays customer cancel of an already CANCELLED owned order', async () => {
      const existing = order({
        status: OrderStatus.CANCELLED,
        cancelledAt: NOW,
        cancelReason: null,
      });
      repository.transitionPendingToCancelledForOwner.mockResolvedValue(null);
      repository.findOwnedById.mockResolvedValue(existing);

      const result = await service.cancelPendingOrderByCustomer({
        orderId: ORDER_ID,
        actor: customer,
      });

      expect(result).toEqual({ order: existing, replay: true });
      expect(inventory.releaseForOrder).not.toHaveBeenCalled();
      expect(discountUsage.releaseForOrder).not.toHaveBeenCalled();
    });

    it('maps inventory consistency failures to ORDER_INVALID_TRANSITION', async () => {
      repository.transitionPendingToCancelledForOwner.mockResolvedValue(
        order({ status: OrderStatus.CANCELLED, cancelledAt: NOW }),
      );
      inventory.releaseForOrder.mockRejectedValue(
        new InventoryReservationNotFoundError(),
      );

      await expect(
        service.cancelPendingOrderByCustomer({
          orderId: ORDER_ID,
          actor: customer,
        }),
      ).rejects.toMatchObject({
        code: 'ORDER_INVALID_TRANSITION',
        message: OrderMessage.CUSTOMER_CANCEL_DENIED,
      });

      inventory.releaseForOrder.mockRejectedValue(
        new InventoryReservationConflictError(),
      );
      await expect(
        service.cancelPendingOrderByCustomer({
          orderId: ORDER_ID,
          actor: customer,
        }),
      ).rejects.toBeInstanceOf(OrderInvalidTransitionError);
    });

    it('returns NOT_FOUND for another user without leaking existence', async () => {
      repository.transitionPendingToCancelledForOwner.mockResolvedValue(null);
      repository.findOwnedById.mockResolvedValue(null);

      await expect(
        service.cancelPendingOrderByCustomer({
          orderId: ORDER_ID,
          actor: { type: OrderActorType.USER, id: OTHER_USER_ID },
        }),
      ).rejects.toBeInstanceOf(OrderNotFoundError);
    });
  });

  describe('cancelOrderByAdmin', () => {
    it('cancels PENDING_REVIEW with a required reason', async () => {
      repository.findById.mockResolvedValue(order());
      repository.transitionPendingToCancelled.mockResolvedValue(
        order({
          status: OrderStatus.CANCELLED,
          cancelledAt: NOW,
          cancelReason: 'out of stock',
        }),
      );
      inventory.releaseForOrder.mockResolvedValue({
        orderId: ORDER_ID,
        lines: [],
      });

      const result = await service.cancelOrderByAdmin({
        orderId: ORDER_ID,
        actor: admin,
        cancelReason: '  out of stock  ',
      });

      expect(result.replay).toBe(false);
      expect(repository.transitionPendingToCancelled).toHaveBeenCalledWith(
        ORDER_ID,
        { cancelReason: 'out of stock' },
        expect.anything(),
      );
      expect(discountUsage.releaseForOrder).toHaveBeenCalledWith(
        { orderId: ORDER_ID, userId: USER_ID },
        expect.anything(),
      );
      expect(inventory.releaseForOrder).toHaveBeenCalledWith(
        {
          orderId: ORDER_ID,
          actor: { type: InventoryLedgerActorType.ADMIN, id: ADMIN_ID },
        },
        expect.anything(),
      );
      expect(
        discountUsage.releaseForOrder.mock.invocationCallOrder[0],
      ).toBeLessThan(inventory.releaseForOrder.mock.invocationCallOrder[0]!);
    });

    it('cancels CONFIRMED', async () => {
      repository.findById.mockResolvedValue(
        order({ status: OrderStatus.CONFIRMED, confirmedAt: CONFIRMED_AT }),
      );
      repository.transitionConfirmedToCancelled.mockResolvedValue(
        order({
          status: OrderStatus.CANCELLED,
          confirmedAt: CONFIRMED_AT,
          cancelledAt: NOW,
          cancelReason: 'customer request',
        }),
      );
      inventory.releaseForOrder.mockResolvedValue({
        orderId: ORDER_ID,
        lines: [],
      });

      await service.cancelOrderByAdmin({
        orderId: ORDER_ID,
        actor: admin,
        cancelReason: 'customer request',
      });

      expect(repository.transitionPendingToCancelled).not.toHaveBeenCalled();
      expect(repository.transitionConfirmedToCancelled).toHaveBeenCalled();
      expect(discountUsage.releaseForOrder).toHaveBeenCalledWith(
        { orderId: ORDER_ID, userId: USER_ID },
        expect.anything(),
      );
      expect(inventory.releaseForOrder).toHaveBeenCalled();
      expect(
        discountUsage.releaseForOrder.mock.invocationCallOrder[0],
      ).toBeLessThan(inventory.releaseForOrder.mock.invocationCallOrder[0]!);
    });

    it('requires a cancellation reason', async () => {
      await expect(
        service.cancelOrderByAdmin({
          orderId: ORDER_ID,
          actor: admin,
          cancelReason: '   ',
        }),
      ).rejects.toBeInstanceOf(OrderCancellationReasonRequiredError);
    });

    it('replays CANCELLED without rewriting reason or calling Inventory', async () => {
      const existing = order({
        status: OrderStatus.CANCELLED,
        cancelledAt: NOW,
        cancelReason: 'original',
      });
      repository.findById.mockResolvedValue(existing);

      const result = await service.cancelOrderByAdmin({
        orderId: ORDER_ID,
        actor: admin,
        cancelReason: 'new reason',
      });

      expect(result).toEqual({ order: existing, replay: true });
      expect(result.order.cancelReason).toBe('original');
      expect(inventory.releaseForOrder).not.toHaveBeenCalled();
      expect(discountUsage.releaseForOrder).not.toHaveBeenCalled();
    });

    it('does not chase CONFIRMED after losing a pending race', async () => {
      repository.findById
        .mockResolvedValueOnce(order())
        .mockResolvedValueOnce(
          order({ status: OrderStatus.CONFIRMED, confirmedAt: CONFIRMED_AT }),
        );
      repository.transitionPendingToCancelled.mockResolvedValue(null);

      await expect(
        service.cancelOrderByAdmin({
          orderId: ORDER_ID,
          actor: admin,
          cancelReason: 'too late',
        }),
      ).rejects.toBeInstanceOf(OrderInvalidTransitionError);
      expect(repository.transitionConfirmedToCancelled).not.toHaveBeenCalled();
    });

    it('preserves Inventory errors for admin cancel', async () => {
      repository.findById.mockResolvedValue(order());
      repository.transitionPendingToCancelled.mockResolvedValue(
        order({ status: OrderStatus.CANCELLED, cancelledAt: NOW }),
      );
      inventory.releaseForOrder.mockRejectedValue(
        new InventoryReservationNotFoundError(),
      );

      await expect(
        service.cancelOrderByAdmin({
          orderId: ORDER_ID,
          actor: admin,
          cancelReason: 'test',
        }),
      ).rejects.toBeInstanceOf(InventoryReservationNotFoundError);
    });
  });

  describe('shipOrder', () => {
    it('ships CONFIRMED after winning the Order update, forwarding the admin actor', async () => {
      const shipped = order({
        status: OrderStatus.SHIPPED,
        confirmedAt: CONFIRMED_AT,
        shippedAt: NOW,
      });
      repository.transitionConfirmedToShipped.mockResolvedValue(shipped);
      inventory.shipForOrder.mockResolvedValue({
        orderId: ORDER_ID,
        lines: [],
      });

      const callOrder: string[] = [];
      repository.transitionConfirmedToShipped.mockImplementation(() => {
        callOrder.push('order');
        return Promise.resolve(shipped);
      });
      inventory.shipForOrder.mockImplementation(() => {
        callOrder.push('inventory');
        return Promise.resolve({ orderId: ORDER_ID, lines: [] });
      });

      const result = await service.shipOrder({
        orderId: ORDER_ID,
        actor: admin,
      });

      expect(result.replay).toBe(false);
      expect(callOrder).toEqual(['order', 'inventory']);
      expect(inventory.shipForOrder).toHaveBeenCalledWith(
        {
          orderId: ORDER_ID,
          actor: { type: InventoryLedgerActorType.ADMIN, id: ADMIN_ID },
        },
        expect.anything(),
      );
    });

    it('replays SHIPPED without calling Inventory', async () => {
      const existing = order({
        status: OrderStatus.SHIPPED,
        confirmedAt: CONFIRMED_AT,
        shippedAt: NOW,
      });
      repository.transitionConfirmedToShipped.mockResolvedValue(null);
      repository.findById.mockResolvedValue(existing);

      const result = await service.shipOrder({
        orderId: ORDER_ID,
        actor: admin,
      });

      expect(result).toEqual({ order: existing, replay: true });
      expect(inventory.shipForOrder).not.toHaveBeenCalled();
    });

    it('propagates Inventory failure after a winning Order update', async () => {
      repository.transitionConfirmedToShipped.mockResolvedValue(
        order({
          status: OrderStatus.SHIPPED,
          confirmedAt: CONFIRMED_AT,
          shippedAt: NOW,
        }),
      );
      inventory.shipForOrder.mockRejectedValue(
        new InventoryReservationNotFoundError(),
      );

      await expect(
        service.shipOrder({ orderId: ORDER_ID, actor: admin }),
      ).rejects.toBeInstanceOf(InventoryReservationNotFoundError);
    });
  });

  describe('deliverOrder', () => {
    it('delivers SHIPPED without Inventory', async () => {
      const delivered = order({
        status: OrderStatus.DELIVERED,
        confirmedAt: CONFIRMED_AT,
        shippedAt: NOW,
        deliveredAt: NOW,
      });
      repository.transitionShippedToDelivered.mockResolvedValue(delivered);

      const result = await service.deliverOrder({
        orderId: ORDER_ID,
        actor: admin,
      });

      expect(result).toEqual({ order: delivered, replay: false });
      expect(inventory.shipForOrder).not.toHaveBeenCalled();
      expect(inventory.releaseForOrder).not.toHaveBeenCalled();
    });

    it('replays DELIVERED without rewriting deliveredAt', async () => {
      const existing = order({
        status: OrderStatus.DELIVERED,
        confirmedAt: CONFIRMED_AT,
        shippedAt: NOW,
        deliveredAt: NOW,
      });
      repository.transitionShippedToDelivered.mockResolvedValue(null);
      repository.findById.mockResolvedValue(existing);

      const result = await service.deliverOrder({
        orderId: ORDER_ID,
        actor: admin,
      });

      expect(result.order.deliveredAt).toEqual(NOW);
      expect(result.replay).toBe(true);
    });

    it('rejects deliver from CONFIRMED', async () => {
      repository.transitionShippedToDelivered.mockResolvedValue(null);
      repository.findById.mockResolvedValue(
        order({ status: OrderStatus.CONFIRMED, confirmedAt: CONFIRMED_AT }),
      );

      await expect(
        service.deliverOrder({ orderId: ORDER_ID, actor: admin }),
      ).rejects.toBeInstanceOf(OrderInvalidTransitionError);
    });
  });

  it('does not expose a generic public transition method', () => {
    expect(
      Object.getOwnPropertyNames(OrderTransitionService.prototype),
    ).not.toContain('transition');
  });
});

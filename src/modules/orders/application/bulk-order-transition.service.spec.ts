import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { OrderActorType } from '../domain/order-actor';
import {
  OrderInvalidTransitionError,
  OrderNotFoundError,
} from '../domain/order-errors';
import { OrderMessage } from '../domain/order-messages';
import { OrderStatus } from '../domain/order-status';
import type { OrderRecord } from '../domain/order';
import {
  BulkOrderTransitionAction,
  BulkOrderTransitionService,
} from './bulk-order-transition.service';
import type { OrderTransitionService } from './order-transition.service';

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORDER_A = '11111111-1111-4111-8111-111111111111';
const ORDER_B = '22222222-2222-4222-8222-222222222222';
const ORDER_C = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-09-02T10:00:00.000Z');

function order(id: string, status: OrderStatus): OrderRecord {
  return {
    id,
    userId: '55555555-5555-4555-8555-555555555555',
    status,
    customerPhone: '+989121234567',
    regionId: '44444444-4444-4444-8444-444444444444',
    regionName: 'Tehran',
    grossSubtotal: 1000n,
    lineDiscountTotal: 0n,
    subtotalAfterLineDiscounts: 1000n,
    orderDiscountAmount: 0n,
    total: 1000n,
    pricingEvaluatedAt: NOW,
    commercePolicyRevision: 1,
    appliedOrderDiscount: null,
    idempotencyKey: '66666666-6666-4666-8666-666666666666',
    idempotencyPayloadHash: 'a'.repeat(64),
    deliveryAt: null,
    confirmedAt: NOW,
    shippedAt: status === OrderStatus.SHIPPED ? NOW : null,
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    lines: [],
  };
}

describe('BulkOrderTransitionService', () => {
  let transitions: jest.Mocked<
    Pick<OrderTransitionService, 'shipOrder' | 'deliverOrder'>
  >;
  let logger: jest.Mocked<Pick<ApplicationLogger, 'error'>>;
  let service: BulkOrderTransitionService;
  const actor = { type: OrderActorType.ADMIN, id: ADMIN_ID } as const;

  beforeEach(() => {
    transitions = {
      shipOrder: jest.fn(),
      deliverOrder: jest.fn(),
    };
    logger = { error: jest.fn() };
    service = new BulkOrderTransitionService(
      transitions as unknown as OrderTransitionService,
      logger as unknown as ApplicationLogger,
    );
  });

  it('ships every order and reports all-success summary', async () => {
    transitions.shipOrder
      .mockResolvedValueOnce({
        order: order(ORDER_A, OrderStatus.SHIPPED),
        replay: false,
      })
      .mockResolvedValueOnce({
        order: order(ORDER_B, OrderStatus.SHIPPED),
        replay: false,
      });

    const result = await service.execute({
      action: BulkOrderTransitionAction.SHIP,
      orderIds: [ORDER_A, ORDER_B],
      actor,
    });

    expect(result).toEqual({
      action: BulkOrderTransitionAction.SHIP,
      summary: { requested: 2, succeeded: 2, failed: 0 },
      results: [
        {
          orderId: ORDER_A,
          success: true,
          replay: false,
          order: order(ORDER_A, OrderStatus.SHIPPED),
        },
        {
          orderId: ORDER_B,
          success: true,
          replay: false,
          order: order(ORDER_B, OrderStatus.SHIPPED),
        },
      ],
    });
    expect(transitions.shipOrder).toHaveBeenCalledTimes(2);
    expect(transitions.deliverOrder).not.toHaveBeenCalled();
  });

  it('delivers through the existing single-order command', async () => {
    transitions.deliverOrder.mockResolvedValue({
      order: order(ORDER_A, OrderStatus.DELIVERED),
      replay: false,
    });

    const result = await service.execute({
      action: BulkOrderTransitionAction.DELIVER,
      orderIds: [ORDER_A],
      actor,
    });

    expect(result.summary).toEqual({ requested: 1, succeeded: 1, failed: 0 });
    expect(transitions.deliverOrder).toHaveBeenCalledWith({
      orderId: ORDER_A,
      actor,
    });
  });

  it('keeps request order, continues after a middle failure, and counts partial success', async () => {
    const callOrder: string[] = [];
    transitions.shipOrder.mockImplementation(({ orderId }) => {
      callOrder.push(orderId);
      if (orderId === ORDER_B) {
        return Promise.reject(new OrderInvalidTransitionError());
      }
      return Promise.resolve({
        order: order(orderId, OrderStatus.SHIPPED),
        replay: false,
      });
    });

    const result = await service.execute({
      action: BulkOrderTransitionAction.SHIP,
      orderIds: [ORDER_A, ORDER_B, ORDER_C],
      actor,
    });

    expect(callOrder).toEqual([ORDER_A, ORDER_B, ORDER_C]);
    expect(result.results.map((item) => item.orderId)).toEqual([
      ORDER_A,
      ORDER_B,
      ORDER_C,
    ]);
    expect(result.summary).toEqual({ requested: 3, succeeded: 2, failed: 1 });
    expect(result.results[1]).toEqual({
      orderId: ORDER_B,
      success: false,
      error: {
        code: 'ORDER_INVALID_TRANSITION',
        message: OrderMessage.INVALID_TRANSITION,
        details: {},
      },
    });
  });

  it('represents replay on successful items', async () => {
    transitions.shipOrder.mockResolvedValue({
      order: order(ORDER_A, OrderStatus.SHIPPED),
      replay: true,
    });

    const result = await service.execute({
      action: BulkOrderTransitionAction.SHIP,
      orderIds: [ORDER_A],
      actor,
    });

    expect(result.results[0]).toMatchObject({
      success: true,
      replay: true,
    });
  });

  it('serializes known domain errors without aborting later items', async () => {
    transitions.shipOrder
      .mockRejectedValueOnce(new OrderNotFoundError())
      .mockResolvedValueOnce({
        order: order(ORDER_B, OrderStatus.SHIPPED),
        replay: false,
      });

    const result = await service.execute({
      action: BulkOrderTransitionAction.SHIP,
      orderIds: [ORDER_A, ORDER_B],
      actor,
    });

    expect(result.results[0]).toEqual({
      orderId: ORDER_A,
      success: false,
      error: {
        code: 'ORDER_NOT_FOUND',
        message: OrderMessage.NOT_FOUND,
        details: {},
      },
    });
    expect(result.results[1]).toMatchObject({
      orderId: ORDER_B,
      success: true,
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('hides unexpected internals behind a stable item failure', async () => {
    transitions.shipOrder
      .mockRejectedValueOnce(new Error('prisma P2002 secret'))
      .mockResolvedValueOnce({
        order: order(ORDER_B, OrderStatus.SHIPPED),
        replay: false,
      });

    const result = await service.execute({
      action: BulkOrderTransitionAction.SHIP,
      orderIds: [ORDER_A, ORDER_B],
      actor,
    });

    expect(result.results[0]).toEqual({
      orderId: ORDER_A,
      success: false,
      error: {
        code: 'ORDER_BULK_ITEM_FAILED',
        message: 'Order transition could not be completed.',
        details: {},
      },
    });
    expect(JSON.stringify(result.results[0])).not.toContain('prisma');
    expect(JSON.stringify(result.results[0])).not.toContain('P2002');
    expect(result.results[1]).toMatchObject({ success: true });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'orders',
        operation: 'order.bulk-transition.item-failed',
        orderId: ORDER_A,
        action: BulkOrderTransitionAction.SHIP,
      }),
      'Bulk order transition item failed unexpectedly',
      expect.any(Error),
    );
  });
});

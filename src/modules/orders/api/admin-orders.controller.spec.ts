import { Permission } from '../../../common/authz/permission';
import { REQUIRED_PERMISSIONS_METADATA_KEY } from '../../../common/authz/require-permissions.decorator';
import { AuthSubjectType } from '../../auth/domain/subject-type';
import { AUTHENTICATED_PRINCIPAL_REQUEST_KEY } from '../../auth/api/access-token.guard';
import { OrderActorType } from '../domain/order-actor';
import { OrderStatus } from '../domain/order-status';
import { OrderMessage } from '../domain/order-messages';
import type { OrderRecord } from '../domain/order';
import type { OrderReadService } from '../application/order-read.service';
import type { OrderTransitionService } from '../application/order-transition.service';
import type { OrderReturnService } from '../application/order-return.service';
import {
  BulkOrderTransitionAction,
  type BulkOrderTransitionService,
} from '../application/bulk-order-transition.service';
import { AdminOrdersController } from './admin-orders.controller';
import type { Request } from 'express';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const ORDER_B = '77777777-7777-4777-8777-777777777777';
const REGION_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-08-28T10:00:00.000Z');

function request(): Request {
  return {
    [AUTHENTICATED_PRINCIPAL_REQUEST_KEY]: {
      subjectId: ADMIN_ID,
      subjectType: AuthSubjectType.ADMIN,
      sessionId: '44444444-4444-4444-8444-444444444444',
    },
  } as unknown as Request;
}

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: ORDER_ID,
    userId: '55555555-5555-4555-8555-555555555555',
    status: OrderStatus.PENDING_REVIEW,
    customerPhone: '+989121234567',
    regionId: REGION_ID,
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
    confirmedAt: null,
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    lines: [],
    ...overrides,
  };
}

describe('AdminOrdersController', () => {
  let reads: jest.Mocked<Pick<OrderReadService, 'listAdmin' | 'getAdmin'>>;
  let transitions: jest.Mocked<
    Pick<
      OrderTransitionService,
      | 'confirmOrder'
      | 'cancelOrderByAdmin'
      | 'shipOrder'
      | 'deliverOrder'
      | 'completeReturnProcess'
    >
  >;
  let bulkTransitions: jest.Mocked<Pick<BulkOrderTransitionService, 'execute'>>;
  let returns: jest.Mocked<Pick<OrderReturnService, 'recordReturn'>>;
  let controller: AdminOrdersController;

  beforeEach(() => {
    reads = { listAdmin: jest.fn(), getAdmin: jest.fn() };
    transitions = {
      confirmOrder: jest.fn(),
      cancelOrderByAdmin: jest.fn(),
      shipOrder: jest.fn(),
      deliverOrder: jest.fn(),
      completeReturnProcess: jest.fn(),
    };
    bulkTransitions = { execute: jest.fn() };
    returns = { recordReturn: jest.fn() };
    controller = new AdminOrdersController(
      reads as unknown as OrderReadService,
      transitions as unknown as OrderTransitionService,
      bulkTransitions as unknown as BulkOrderTransitionService,
      returns as unknown as OrderReturnService,
    );
  });

  it('derives the Admin actor and passes the required idempotency key for a return', async () => {
    returns.recordReturn.mockResolvedValue({
      replay: false,
      orderReturn: {
        id: '77777777-7777-4777-8777-777777777777',
        orderId: ORDER_ID,
        recordedByAdminId: ADMIN_ID,
        reason: 'Inspection complete',
        idempotencyKey: '88888888-8888-4888-8888-888888888888',
        idempotencyPayloadHash: 'a'.repeat(64),
        createdAt: NOW,
        lines: [],
      },
    });
    await controller.recordReturn(
      request(),
      ORDER_ID,
      '88888888-8888-4888-8888-888888888888',
      { reason: 'Inspection complete', lines: [] },
    );
    expect(returns.recordReturn).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      idempotencyKey: '88888888-8888-4888-8888-888888888888',
      reason: 'Inspection complete',
      lines: [],
      actor: { type: OrderActorType.ADMIN, id: ADMIN_ID },
    });
  });

  it('maps Admin list rows and keeps list rows free of lines/internal fields', async () => {
    reads.listAdmin.mockResolvedValue({
      data: [{ ...order(), deliveryAt: new Date('2026-08-29T10:00:00.000Z') }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    const result = await controller.list({});
    expect(result.data[0]).toMatchObject({
      id: ORDER_ID,
      customerPhone: '+989121234567',
      total: 1000,
      deliveryAt: '2026-08-29T10:00:00.000Z',
    });
    expect(result.data[0]).not.toHaveProperty('lines');
    expect(result.data[0]).not.toHaveProperty('idempotencyPayloadHash');
  });

  it('returns persisted Admin detail snapshots and cancellation evidence', async () => {
    reads.getAdmin.mockResolvedValue(
      order({ status: OrderStatus.CANCELLED, cancelReason: 'Out of stock' }),
    );
    const result = await controller.get(ORDER_ID);
    expect(result.data.cancelReason).toBe('Out of stock');
    expect(result.data.status).toBe(OrderStatus.CANCELLED);
    expect(result.data).not.toHaveProperty('userId');
    expect(result.data).not.toHaveProperty('idempotencyKey');
  });

  it('binds the authenticated Admin actor for confirm and trims via domain command', async () => {
    transitions.confirmOrder.mockResolvedValue({
      order: order({ status: OrderStatus.CONFIRMED }),
      replay: false,
    });
    await controller.confirm(request(), ORDER_ID, {
      deliveryAt: '2026-08-29T10:00:00.000Z',
    });
    expect(transitions.confirmOrder).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      deliveryAt: '2026-08-29T10:00:00.000Z',
      actor: { type: OrderActorType.ADMIN, id: ADMIN_ID },
    });
  });

  it('binds the authenticated Admin actor for explicit return completion', async () => {
    transitions.completeReturnProcess.mockResolvedValue({
      order: order({ status: OrderStatus.RETURNED, returnedAt: NOW }),
      replay: false,
    });

    await controller.completeReturn(request(), ORDER_ID);

    expect(transitions.completeReturnProcess).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      actor: { type: OrderActorType.ADMIN, id: ADMIN_ID },
    });
  });

  it('binds the authenticated Admin actor and preserves reason validation at the command boundary', async () => {
    transitions.cancelOrderByAdmin.mockResolvedValue({
      order: order({ status: OrderStatus.CANCELLED, cancelReason: 'No stock' }),
      replay: false,
    });
    await controller.cancel(request(), ORDER_ID, {
      cancelReason: ' No stock ',
    });
    expect(transitions.cancelOrderByAdmin).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      cancelReason: ' No stock ',
      actor: { type: OrderActorType.ADMIN, id: ADMIN_ID },
    });
  });

  it('requires ORDER_TRANSITION for bulk-transition', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      AdminOrdersController.prototype,
      'bulkTransition',
    );
    expect(typeof descriptor?.value).toBe('function');
    const required = Reflect.getMetadata(
      REQUIRED_PERMISSIONS_METADATA_KEY,
      descriptor!.value as object,
    ) as Permission[] | undefined;
    expect(required).toEqual([Permission.ORDER_TRANSITION]);
  });

  it('derives the Admin actor for bulk SHIP and maps the partial-success contract', async () => {
    bulkTransitions.execute.mockResolvedValue({
      action: BulkOrderTransitionAction.SHIP,
      summary: { requested: 2, succeeded: 1, failed: 1 },
      results: [
        {
          orderId: ORDER_ID,
          success: true,
          replay: false,
          order: order({ status: OrderStatus.SHIPPED, shippedAt: NOW }),
        },
        {
          orderId: ORDER_B,
          success: false,
          error: {
            code: 'ORDER_NOT_FOUND',
            message: OrderMessage.NOT_FOUND,
            details: {},
          },
        },
      ],
    });

    const result = await controller.bulkTransition(request(), {
      action: BulkOrderTransitionAction.SHIP,
      orderIds: [ORDER_ID, ORDER_B],
    });

    expect(bulkTransitions.execute).toHaveBeenCalledWith({
      action: BulkOrderTransitionAction.SHIP,
      orderIds: [ORDER_ID, ORDER_B],
      actor: { type: OrderActorType.ADMIN, id: ADMIN_ID },
    });
    expect(result.data.summary).toEqual({
      requested: 2,
      succeeded: 1,
      failed: 1,
    });
    const first = result.data.results[0];
    expect(first?.success).toBe(true);
    if (first?.success === true) {
      expect(first.replay).toBe(false);
      expect(first.order.id).toBe(ORDER_ID);
      expect(first.order.status).toBe(OrderStatus.SHIPPED);
    }
    expect(result.data.results[1]).toEqual({
      orderId: ORDER_B,
      success: false,
      error: {
        code: 'ORDER_NOT_FOUND',
        message: OrderMessage.NOT_FOUND,
        details: {},
      },
    });
  });

  it('derives the Admin actor for bulk DELIVER', async () => {
    bulkTransitions.execute.mockResolvedValue({
      action: BulkOrderTransitionAction.DELIVER,
      summary: { requested: 1, succeeded: 1, failed: 0 },
      results: [
        {
          orderId: ORDER_ID,
          success: true,
          replay: false,
          order: order({ status: OrderStatus.DELIVERED, deliveredAt: NOW }),
        },
      ],
    });

    await controller.bulkTransition(request(), {
      action: BulkOrderTransitionAction.DELIVER,
      orderIds: [ORDER_ID],
    });

    expect(bulkTransitions.execute).toHaveBeenCalledWith({
      action: BulkOrderTransitionAction.DELIVER,
      orderIds: [ORDER_ID],
      actor: { type: OrderActorType.ADMIN, id: ADMIN_ID },
    });
  });
});

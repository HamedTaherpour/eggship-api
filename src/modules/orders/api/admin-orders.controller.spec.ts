import { AuthSubjectType } from '../../auth/domain/subject-type';
import { AUTHENTICATED_PRINCIPAL_REQUEST_KEY } from '../../auth/api/access-token.guard';
import { OrderActorType } from '../domain/order-actor';
import { OrderStatus } from '../domain/order-status';
import type { OrderRecord } from '../domain/order';
import type { OrderReadService } from '../application/order-read.service';
import type { OrderTransitionService } from '../application/order-transition.service';
import { AdminOrdersController } from './admin-orders.controller';
import type { Request } from 'express';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
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
      'confirmOrder' | 'cancelOrderByAdmin' | 'shipOrder' | 'deliverOrder'
    >
  >;
  let controller: AdminOrdersController;

  beforeEach(() => {
    reads = { listAdmin: jest.fn(), getAdmin: jest.fn() };
    transitions = {
      confirmOrder: jest.fn(),
      cancelOrderByAdmin: jest.fn(),
      shipOrder: jest.fn(),
      deliverOrder: jest.fn(),
    };
    controller = new AdminOrdersController(
      reads as unknown as OrderReadService,
      transitions as unknown as OrderTransitionService,
    );
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
});

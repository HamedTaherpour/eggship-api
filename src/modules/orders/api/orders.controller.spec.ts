import { HttpStatus } from '@nestjs/common';
import { OrderNotFoundError } from '../domain/order-errors';
import { OrderActorType } from '../domain/order-actor';
import { OrderStatus } from '../domain/order-status';
import type { OrderRecord } from '../domain/order';
import type { OrderCreationService } from '../application/order-creation.service';
import type { OrderReadService } from '../application/order-read.service';
import { OrdersController } from './orders.controller';
import type { CreateOrderBodyDto } from './dto/create-order.dto';
import { AuthSubjectType } from '../../auth/domain/subject-type';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import { AUTHENTICATED_PRINCIPAL_REQUEST_KEY } from '../../auth/api/access-token.guard';
import type { Request, Response } from 'express';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const REGION_ID = '33333333-3333-4333-8333-333333333333';
const PRODUCT_ID = '44444444-4444-4444-8444-444444444444';
const ORDER_ID = '55555555-5555-4555-8555-555555555555';
const IDEMPOTENCY_KEY = '66666666-6666-4666-8666-666666666666';

function orderRecord(overrides: Partial<OrderRecord> = {}): OrderRecord {
  const now = new Date('2026-08-22T10:00:00.000Z');
  return {
    id: ORDER_ID,
    userId: USER_ID,
    status: OrderStatus.PENDING_REVIEW,
    customerPhone: '+989121234567',
    regionId: REGION_ID,
    regionName: 'Tehran',
    grossSubtotal: 20_000n,
    lineDiscountTotal: 0n,
    subtotalAfterLineDiscounts: 20_000n,
    orderDiscountAmount: 0n,
    total: 20_000n,
    pricingEvaluatedAt: now,
    commercePolicyRevision: 3,
    appliedOrderDiscount: null,
    idempotencyKey: IDEMPOTENCY_KEY,
    idempotencyPayloadHash: 'a'.repeat(64),
    deliveryAt: null,
    confirmedAt: null,
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: now,
    updatedAt: now,
    lines: [
      {
        id: '77777777-7777-4777-8777-777777777777',
        orderId: ORDER_ID,
        productId: PRODUCT_ID,
        productName: 'Eggs',
        unitPrice: 10_000,
        quantity: 2,
        discountedQuantity: 0,
        grossLineTotal: 20_000n,
        lineDiscountAmount: 0n,
        finalLineTotal: 20_000n,
        appliedLineDiscount: null,
        createdAt: now,
      },
    ],
    ...overrides,
  };
}

function requestWithPrincipal(
  principal: AuthenticatedPrincipal | undefined,
): Request {
  return {
    [AUTHENTICATED_PRINCIPAL_REQUEST_KEY]: principal,
  } as unknown as Request;
}

describe('OrdersController create (ORD-03A)', () => {
  let createOrder: jest.MockedFunction<OrderCreationService['createOrder']>;
  let listOwned: jest.MockedFunction<OrderReadService['listOwned']>;
  let getOwned: jest.MockedFunction<OrderReadService['getOwned']>;
  let controller: OrdersController;
  let statusCode: number | undefined;
  let response: Response;

  beforeEach(() => {
    createOrder = jest.fn();
    listOwned = jest.fn();
    getOwned = jest.fn();
    controller = new OrdersController(
      { createOrder } as unknown as OrderCreationService,
      { listOwned, getOwned } as unknown as OrderReadService,
    );
    statusCode = undefined;
    response = {
      setHeader: jest.fn(),
      status: (code: number) => {
        statusCode = code;
        return response;
      },
    } as unknown as Response;
  });

  const body: CreateOrderBodyDto = {
    regionId: REGION_ID,
    lines: [{ productId: PRODUCT_ID, quantity: 2 }],
  };

  it('binds principal owner as USER actor and ignores body ownership fields', async () => {
    createOrder.mockResolvedValue({ order: orderRecord(), created: true });
    const request = requestWithPrincipal({
      subjectId: USER_ID,
      subjectType: AuthSubjectType.USER,
      sessionId: '88888888-8888-4888-8888-888888888888',
    });
    const spoofed = {
      ...body,
      userId: ADMIN_ID,
      actor: { type: 'ADMIN', id: ADMIN_ID },
      actorId: ADMIN_ID,
      customerPhone: '+989999999999',
      total: 1,
      status: 'CONFIRMED',
    } as CreateOrderBodyDto;

    const result = await controller.create(
      request,
      response,
      spoofed,
      IDEMPOTENCY_KEY,
    );

    expect(createOrder).toHaveBeenCalledWith({
      actor: { type: OrderActorType.USER, id: USER_ID },
      regionId: REGION_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      lines: [{ productId: PRODUCT_ID, quantity: 2 }],
    });
    expect(statusCode).toBe(HttpStatus.CREATED);
    expect(result.data.id).toBe(ORDER_ID);
    expect(result.data).not.toHaveProperty('userId');
    expect(result.data).not.toHaveProperty('idempotencyPayloadHash');
    expect(result.data).not.toHaveProperty('commercePolicyRevision');
    expect(result.data).not.toHaveProperty('cancelReason');
  });

  it('returns 200 on idempotent replay', async () => {
    createOrder.mockResolvedValue({ order: orderRecord(), created: false });
    const request = requestWithPrincipal({
      subjectId: USER_ID,
      subjectType: AuthSubjectType.USER,
      sessionId: '88888888-8888-4888-8888-888888888888',
    });

    await controller.create(request, response, body, IDEMPOTENCY_KEY);

    expect(statusCode).toBe(HttpStatus.OK);
  });

  it('rejects Admin principals before calling createOrder', async () => {
    const request = requestWithPrincipal({
      subjectId: ADMIN_ID,
      subjectType: AuthSubjectType.ADMIN,
      sessionId: '88888888-8888-4888-8888-888888888888',
    });

    await expect(
      controller.create(request, response, body, IDEMPOTENCY_KEY),
    ).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('rejects missing principal before calling createOrder', async () => {
    await expect(
      controller.create(
        requestWithPrincipal(undefined),
        response,
        body,
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });
    expect(createOrder).not.toHaveBeenCalled();
  });
});

describe('OrdersController read (ORD-04)', () => {
  let createOrder: jest.MockedFunction<OrderCreationService['createOrder']>;
  let listOwned: jest.MockedFunction<OrderReadService['listOwned']>;
  let getOwned: jest.MockedFunction<OrderReadService['getOwned']>;
  let controller: OrdersController;

  beforeEach(() => {
    createOrder = jest.fn();
    listOwned = jest.fn();
    getOwned = jest.fn();
    controller = new OrdersController(
      { createOrder } as unknown as OrderCreationService,
      { listOwned, getOwned } as unknown as OrderReadService,
    );
  });

  const userPrincipal: AuthenticatedPrincipal = {
    subjectId: USER_ID,
    subjectType: AuthSubjectType.USER,
    sessionId: '88888888-8888-4888-8888-888888888888',
  };

  it('lists owned orders for USER principal', async () => {
    listOwned.mockResolvedValue({
      data: [
        {
          id: ORDER_ID,
          status: OrderStatus.PENDING_REVIEW,
          regionId: REGION_ID,
          regionName: 'Tehran',
          total: 20_000n,
          createdAt: new Date('2026-08-22T10:00:00.000Z'),
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });

    const result = await controller.list(requestWithPrincipal(userPrincipal), {
      page: 1,
      pageSize: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(listOwned).toHaveBeenCalledWith(USER_ID, {
      page: 1,
      pageSize: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    expect(result.data[0]).toMatchObject({
      id: ORDER_ID,
      regionName: 'Tehran',
      total: 20_000,
    });
    expect(result.data[0]).not.toHaveProperty('userId');
    expect(result.data[0]).not.toHaveProperty('lines');
  });

  it('returns owned order detail without internal fields', async () => {
    getOwned.mockResolvedValue(orderRecord());

    const result = await controller.get(
      requestWithPrincipal(userPrincipal),
      ORDER_ID,
    );

    expect(getOwned).toHaveBeenCalledWith(USER_ID, ORDER_ID);
    expect(result.data.lines).toHaveLength(1);
    expect(result.data).not.toHaveProperty('userId');
    expect(result.data).not.toHaveProperty('idempotencyKey');
    expect(result.data).not.toHaveProperty('cancelReason');
    expect(result.data).toHaveProperty('confirmedAt');
  });

  it('rejects Admin principals on list before calling read service', async () => {
    await expect(
      controller.list(
        requestWithPrincipal({
          subjectId: ADMIN_ID,
          subjectType: AuthSubjectType.ADMIN,
          sessionId: '88888888-8888-4888-8888-888888888888',
        }),
        { page: 1, pageSize: 20, sortBy: 'createdAt', sortOrder: 'desc' },
      ),
    ).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    expect(listOwned).not.toHaveBeenCalled();
  });

  it('rejects Admin principals on detail before calling read service', async () => {
    await expect(
      controller.get(
        requestWithPrincipal({
          subjectId: ADMIN_ID,
          subjectType: AuthSubjectType.ADMIN,
          sessionId: '88888888-8888-4888-8888-888888888888',
        }),
        ORDER_ID,
      ),
    ).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    expect(getOwned).not.toHaveBeenCalled();
  });

  it('propagates ORDER_NOT_FOUND from read service', async () => {
    getOwned.mockRejectedValue(new OrderNotFoundError());

    await expect(
      controller.get(requestWithPrincipal(userPrincipal), ORDER_ID),
    ).rejects.toBeInstanceOf(OrderNotFoundError);
  });
});

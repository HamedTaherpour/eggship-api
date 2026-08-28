import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { createOpenApiDocument } from '../src/common/openapi/openapi.document';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import { AuthSubjectType } from '../src/modules/auth/domain/subject-type';
import { OrderCreationService } from '../src/modules/orders/application/order-creation.service';
import { OrderReadService } from '../src/modules/orders/application/order-read.service';
import { OrderTransitionService } from '../src/modules/orders/application/order-transition.service';
import type { OrderRecord } from '../src/modules/orders/domain/order';
import { OrderNotFoundError } from '../src/modules/orders/domain/order-errors';
import { OrderStatus } from '../src/modules/orders/domain/order-status';
import {
  bootstrapBrowserCsrf,
  browserRequest,
  type BrowserCsrfSession,
} from './helpers/csrf-browser';

const ORDER_ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '11111111-1111-4111-8111-111111111111';

class FakeOrderTransitionService {
  lastRequest: {
    orderId: string;
    userId: string;
  } | null = null;

  cancelPendingOrderByCustomer(input: {
    orderId: string;
    actor: { id: string };
  }): Promise<{ order: OrderRecord; replay: boolean }> {
    this.lastRequest = { orderId: input.orderId, userId: input.actor.id };
    if (input.actor.id !== USER_ID || input.orderId !== ORDER_ID) {
      return Promise.reject(new OrderNotFoundError());
    }
    return Promise.resolve({
      order: sampleCancelledOrder(input.actor.id, input.orderId),
      replay: false,
    });
  }
}

function sampleCancelledOrder(userId: string, orderId: string): OrderRecord {
  const now = new Date('2026-08-22T10:00:00.000Z');
  return {
    id: orderId,
    userId,
    status: OrderStatus.CANCELLED,
    customerPhone: '+989121234567',
    regionId: '33333333-3333-4333-8333-333333333333',
    regionName: 'Historical Region',
    grossSubtotal: 20_000n,
    lineDiscountTotal: 0n,
    subtotalAfterLineDiscounts: 20_000n,
    orderDiscountAmount: 0n,
    total: 20_000n,
    pricingEvaluatedAt: now,
    commercePolicyRevision: 7,
    appliedOrderDiscount: null,
    idempotencyKey: randomUUID(),
    idempotencyPayloadHash: 'b'.repeat(64),
    deliveryAt: null,
    confirmedAt: null,
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: now,
    cancelReason: null,
    createdAt: now,
    updatedAt: now,
    lines: [
      {
        id: '77777777-7777-4777-8777-777777777777',
        orderId,
        productId: '44444444-4444-4444-8444-444444444444',
        productName: 'Historical Eggs',
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
  };
}

function signAccessToken(
  subjectType: AuthSubjectType,
  subjectId: string = randomUUID(),
): string {
  return jwt.sign(
    {
      sub: subjectId,
      subjectType,
      sessionId: randomUUID(),
      tokenUse: 'access',
    },
    process.env['JWT_ACCESS_SECRET'] ?? '',
    { algorithm: 'HS256', expiresIn: 900 },
  );
}

interface ApiErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
  requestId: string;
}

describe('Orders cancellation HTTP (ORD-05, e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let fakeTransitions: FakeOrderTransitionService;
  let csrf: BrowserCsrfSession;

  beforeAll(async () => {
    fakeTransitions = new FakeOrderTransitionService();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(OrderCreationService)
      .useValue({})
      .overrideProvider(OrderReadService)
      .useValue({})
      .overrideProvider(OrderTransitionService)
      .useValue(fakeTransitions)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApplication(app);
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    csrf = await bootstrapBrowserCsrf(server);
  });

  it('rejects unauthenticated cancellation', async () => {
    const response = await browserRequest(
      request(server).post(`/api/v1/orders/${ORDER_ID}/cancel`),
      csrf,
    )
      .send({})
      .expect(401);

    expect((response.body as ApiErrorBody).error.code).toBe(
      'AUTH_UNAUTHENTICATED',
    );
    expect(fakeTransitions.lastRequest).toBeNull();
  });

  it('rejects ADMIN subjects before the transition command', async () => {
    await request(server)
      .post(`/api/v1/orders/${ORDER_ID}/cancel`)
      .set('Authorization', `Bearer ${signAccessToken(AuthSubjectType.ADMIN)}`)
      .send({})
      .expect(403);

    expect(fakeTransitions.lastRequest).toBeNull();
  });

  it('binds owner scope to the USER principal and returns a safe cancelled order', async () => {
    const response = await request(server)
      .post(`/api/v1/orders/${ORDER_ID}/cancel`)
      .set(
        'Authorization',
        `Bearer ${signAccessToken(AuthSubjectType.USER, USER_ID)}`,
      )
      .send({})
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(fakeTransitions.lastRequest).toEqual({
      orderId: ORDER_ID,
      userId: USER_ID,
    });
    const body = response.body as { data: Record<string, unknown> };
    expect(body).toMatchObject({
      data: {
        id: ORDER_ID,
        status: 'CANCELLED',
        cancelledAt: '2026-08-22T10:00:00.000Z',
      },
    });
    expect(body.data).not.toHaveProperty('userId');
    expect(body.data).not.toHaveProperty('cancelReason');
  });

  it('rejects command fields instead of accepting client-controlled cancellation data', async () => {
    await request(server)
      .post(`/api/v1/orders/${ORDER_ID}/cancel`)
      .set(
        'Authorization',
        `Bearer ${signAccessToken(AuthSubjectType.USER, USER_ID)}`,
      )
      .send({ reason: 'client-controlled' })
      .expect(400);

    expect(fakeTransitions.lastRequest).toEqual({
      orderId: ORDER_ID,
      userId: USER_ID,
    });
  });

  it('maps another customer order to BOLA-safe ORDER_NOT_FOUND', async () => {
    const response = await request(server)
      .post(`/api/v1/orders/${ORDER_ID}/cancel`)
      .set(
        'Authorization',
        `Bearer ${signAccessToken(AuthSubjectType.USER, randomUUID())}`,
      )
      .send({})
      .expect(404);

    expect((response.body as ApiErrorBody).error.code).toBe('ORDER_NOT_FOUND');
  });

  it('documents Orders_cancel in OpenAPI', () => {
    const document = createOpenApiDocument(app);
    expect(
      document.paths['/api/v1/orders/{id}/cancel']?.post?.operationId,
    ).toBe('Orders_cancel');
  });
});

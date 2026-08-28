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
import type {
  CreateOrderCommand,
  CreateOrderResult,
} from '../src/modules/orders/application/order-creation.commands';
import type { OrderRecord } from '../src/modules/orders/domain/order';
import { OrderActorType } from '../src/modules/orders/domain/order-actor';
import {
  OrderIdempotencyConflictError,
  OrderInvalidProductError,
  OrderInvalidRegionError,
  OrderInvalidUserError,
} from '../src/modules/orders/domain/order-errors';
import { OrderMessage } from '../src/modules/orders/domain/order-messages';
import { OrderStatus } from '../src/modules/orders/domain/order-status';
import {
  OrderingClosedError,
  OrderingPolicyUnavailableError,
  OrderMinimumQuantityNotMetError,
} from '../src/modules/commerce-policy/domain/commerce-policy-errors';
import { InventoryInsufficientStockError } from '../src/modules/inventory/domain/inventory-errors';
import {
  bootstrapBrowserCsrf,
  browserRequest,
  type BrowserCsrfSession,
} from './helpers/csrf-browser';

const REGION_ID = '33333333-3333-4333-8333-333333333333';
const PRODUCT_ID = '44444444-4444-4444-8444-444444444444';
const ORDER_ID = '55555555-5555-4555-8555-555555555555';

class FakeOrderCreationService {
  lastCommand: CreateOrderCommand | null = null;
  behavior:
    { type: 'success'; created: boolean } | { type: 'throw'; error: Error } = {
    type: 'success',
    created: true,
  };

  reset(): void {
    this.lastCommand = null;
    this.behavior = { type: 'success', created: true };
  }

  createOrder(input: CreateOrderCommand): Promise<CreateOrderResult> {
    this.lastCommand = input;
    if (this.behavior.type === 'throw') {
      return Promise.reject(this.behavior.error);
    }
    return Promise.resolve({
      order: sampleOrder(input),
      created: this.behavior.created,
    });
  }
}

function sampleOrder(input: CreateOrderCommand): OrderRecord {
  const now = new Date('2026-08-22T10:00:00.000Z');
  return {
    id: ORDER_ID,
    userId: input.actor.id,
    status: OrderStatus.PENDING_REVIEW,
    customerPhone: '+989121234567',
    regionId: input.regionId,
    regionName: 'Tehran',
    grossSubtotal: 20_000n,
    lineDiscountTotal: 0n,
    subtotalAfterLineDiscounts: 20_000n,
    orderDiscountAmount: 0n,
    total: 20_000n,
    pricingEvaluatedAt: now,
    commercePolicyRevision: 7,
    appliedOrderDiscount: null,
    idempotencyKey: input.idempotencyKey,
    idempotencyPayloadHash: 'b'.repeat(64),
    deliveryAt: null,
    confirmedAt: null,
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: 'should-not-leak',
    createdAt: now,
    updatedAt: now,
    lines: input.lines.map((line, index) => ({
      id: `77777777-7777-4777-8777-77777777777${index}`,
      orderId: ORDER_ID,
      productId: line.productId,
      productName: 'Eggs',
      unitPrice: 10_000,
      quantity: line.quantity,
      discountedQuantity: 0,
      grossLineTotal: BigInt(10_000 * line.quantity),
      lineDiscountAmount: 0n,
      finalLineTotal: BigInt(10_000 * line.quantity),
      appliedLineDiscount: null,
      createdAt: now,
    })),
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

describe('Orders create HTTP (ORD-03A, e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let fakeCreation: FakeOrderCreationService;
  let userId: string;
  let csrf: BrowserCsrfSession;

  beforeAll(async () => {
    fakeCreation = new FakeOrderCreationService();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(OrderCreationService)
      .useValue(fakeCreation)
      .compile();

    app = moduleRef.createNestApplication({
      logger: false,
    });
    configureApplication(app);
    await app.init();
    server = app.getHttpServer() as Server;
  });

  beforeEach(async () => {
    fakeCreation.reset();
    userId = randomUUID();
    csrf = await bootstrapBrowserCsrf(server);
  });

  afterAll(async () => {
    await app.close();
  });

  function createBody(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      regionId: REGION_ID,
      lines: [{ productId: PRODUCT_ID, quantity: 2 }],
      ...overrides,
    };
  }

  it('rejects unauthenticated create', async () => {
    const response = await browserRequest(
      request(server).post('/api/v1/orders'),
      csrf,
    )
      .set('Idempotency-Key', randomUUID())
      .send(createBody())
      .expect(401);

    const body = response.body as ApiErrorBody;
    expect(body.error.code).toBe('AUTH_UNAUTHENTICATED');
    expect(response.headers['x-request-id']).toBe(body.requestId);
    expect(fakeCreation.lastCommand).toBeNull();
  });

  it('rejects ADMIN subjects as customer creators', async () => {
    const response = await request(server)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${signAccessToken(AuthSubjectType.ADMIN)}`)
      .set('Idempotency-Key', randomUUID())
      .send(createBody())
      .expect(403);

    expect((response.body as ApiErrorBody).error.code).toBe('AUTH_FORBIDDEN');
    expect(fakeCreation.lastCommand).toBeNull();
  });

  it('creates for authenticated USER with principal-bound actor', async () => {
    const key = randomUUID();
    const response = await request(server)
      .post('/api/v1/orders')
      .set(
        'Authorization',
        `Bearer ${signAccessToken(AuthSubjectType.USER, userId)}`,
      )
      .set('Idempotency-Key', key)
      .set('Cache-Control', 'max-age=3600')
      .send(createBody())
      .expect(201);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(fakeCreation.lastCommand).toEqual({
      actor: { type: OrderActorType.USER, id: userId },
      regionId: REGION_ID,
      idempotencyKey: key,
      lines: [{ productId: PRODUCT_ID, quantity: 2 }],
    });

    const payload = response.body as {
      data: Record<string, unknown>;
    };
    expect(payload.data['id']).toBe(ORDER_ID);
    expect(payload.data['status']).toBe('PENDING_REVIEW');
    expect(payload.data).not.toHaveProperty('userId');
    expect(payload.data).not.toHaveProperty('idempotencyKey');
    expect(payload.data).not.toHaveProperty('idempotencyPayloadHash');
    expect(payload.data).not.toHaveProperty('commercePolicyRevision');
    expect(payload.data).not.toHaveProperty('cancelReason');
    expect(payload.data).not.toHaveProperty('cancelledAt');
  });

  it('replays identical creates with HTTP 200', async () => {
    fakeCreation.behavior = { type: 'success', created: false };
    const key = randomUUID();

    const response = await request(server)
      .post('/api/v1/orders')
      .set(
        'Authorization',
        `Bearer ${signAccessToken(AuthSubjectType.USER, userId)}`,
      )
      .set('Idempotency-Key', key)
      .send(createBody())
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect((response.body as { data: { id: string } }).data.id).toBe(ORDER_ID);
  });

  it('maps idempotency conflict', async () => {
    fakeCreation.behavior = {
      type: 'throw',
      error: new OrderIdempotencyConflictError(),
    };

    const response = await request(server)
      .post('/api/v1/orders')
      .set(
        'Authorization',
        `Bearer ${signAccessToken(AuthSubjectType.USER, userId)}`,
      )
      .set('Idempotency-Key', randomUUID())
      .send(createBody())
      .expect(409);

    expect((response.body as ApiErrorBody).error.code).toBe(
      'ORDER_IDEMPOTENCY_CONFLICT',
    );
  });

  it('rejects invalid body and missing idempotency key', async () => {
    const token = signAccessToken(AuthSubjectType.USER, userId);

    const missingKey = await request(server)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send(createBody())
      .expect(400);
    expect((missingKey.body as ApiErrorBody).error.code).toBe(
      'IDEMPOTENCY_KEY_REQUIRED',
    );

    const invalidBody = await request(server)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ regionId: REGION_ID, lines: [] })
      .expect(400);
    expect((invalidBody.body as ApiErrorBody).error.code).toBeDefined();
    expect(fakeCreation.lastCommand).toBeNull();

    const spoof = await request(server)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send(
        createBody({
          userId: randomUUID(),
          total: 1,
          customerPhone: '+989999999999',
        }),
      )
      .expect(400);
    expect((spoof.body as ApiErrorBody).error.code).toBeDefined();
    expect(fakeCreation.lastCommand).toBeNull();
  });

  it('maps closed ordering, minimum, stock, inactive user, region, and product errors', async () => {
    const token = signAccessToken(AuthSubjectType.USER, userId);
    const cases: Array<{ error: Error; status: number; code: string }> = [
      {
        error: new OrderingClosedError(),
        status: 409,
        code: 'ORDERING_CLOSED',
      },
      {
        error: new OrderMinimumQuantityNotMetError(5, 1),
        status: 422,
        code: 'ORDER_MINIMUM_QUANTITY_NOT_MET',
      },
      {
        error: new InventoryInsufficientStockError(),
        status: 409,
        code: 'INVENTORY_INSUFFICIENT_STOCK',
      },
      {
        error: new OrderInvalidUserError(OrderMessage.INVALID_USER),
        status: 400,
        code: 'ORDER_INVALID_USER',
      },
      {
        error: new OrderInvalidRegionError(OrderMessage.INVALID_REGION),
        status: 400,
        code: 'ORDER_INVALID_REGION',
      },
      {
        error: new OrderInvalidProductError(OrderMessage.PRODUCT_UNAVAILABLE),
        status: 400,
        code: 'ORDER_INVALID_PRODUCT',
      },
      {
        error: new OrderingPolicyUnavailableError(),
        status: 503,
        code: 'ORDERING_POLICY_UNAVAILABLE',
      },
    ];

    for (const row of cases) {
      fakeCreation.reset();
      fakeCreation.behavior = { type: 'throw', error: row.error };
      const response = await request(server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send(createBody())
        .expect(row.status);
      const body = response.body as ApiErrorBody;
      expect(body.error.code).toBe(row.code);
      expect(response.headers['x-request-id']).toBe(body.requestId);
      expect(JSON.stringify(body)).not.toMatch(/Prisma|SQLSTATE|P20\d{2}/i);
    }
  });

  it('rejects nested line money fields and keeps no-store on errors', async () => {
    const token = signAccessToken(AuthSubjectType.USER, userId);
    const nested = await request(server)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        regionId: REGION_ID,
        lines: [
          {
            productId: PRODUCT_ID,
            quantity: 2,
            unitPrice: 1,
            productName: 'spoof',
            total: 1,
          },
        ],
      })
      .expect(400);
    expect((nested.body as ApiErrorBody).error.code).toBeDefined();
    expect(nested.headers['cache-control']).toBe('no-store');
    expect(fakeCreation.lastCommand).toBeNull();

    fakeCreation.behavior = {
      type: 'throw',
      error: new OrderIdempotencyConflictError(),
    };
    const conflict = await request(server)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send(createBody())
      .expect(409);
    expect(conflict.headers['cache-control']).toBe('no-store');
  });

  it('documents Orders_create in OpenAPI', () => {
    const document = createOpenApiDocument(app);
    const pathItem = document.paths['/api/v1/orders'];
    expect(pathItem?.post?.operationId).toBe('Orders_create');
    expect(pathItem?.post?.parameters ?? []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Idempotency-Key',
          required: true,
        }),
      ]),
    );
  });
});

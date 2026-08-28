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
import { OrderReadService } from '../src/modules/orders/application/order-read.service';
import type { OrderRecord } from '../src/modules/orders/domain/order';
import { OrderNotFoundError } from '../src/modules/orders/domain/order-errors';
import { OrderStatus } from '../src/modules/orders/domain/order-status';

const REGION_ID = '33333333-3333-4333-8333-333333333333';
const PRODUCT_ID = '44444444-4444-4444-8444-444444444444';
const ORDER_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_ORDER_ID = '66666666-6666-4666-8666-666666666666';

class FakeOrderReadService {
  lastOwnerId: string | null = null;
  lastListQuery: Record<string, unknown> | null = null;
  lastDetailId: string | null = null;

  reset(): void {
    this.lastOwnerId = null;
    this.lastListQuery = null;
    this.lastDetailId = null;
  }

  listOwned(
    ownerId: string,
    query: Record<string, unknown>,
  ): Promise<{
    data: Array<{
      id: string;
      status: string;
      regionId: string;
      regionName: string;
      total: bigint;
      createdAt: Date;
    }>;
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    this.lastOwnerId = ownerId;
    this.lastListQuery = query;
    const page = typeof query.page === 'number' ? query.page : 1;
    const pageSize = typeof query.pageSize === 'number' ? query.pageSize : 20;
    return Promise.resolve({
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
      meta: { page, pageSize, total: 1, totalPages: 1 },
    });
  }

  getOwned(ownerId: string, orderId: string): Promise<OrderRecord> {
    this.lastOwnerId = ownerId;
    this.lastDetailId = orderId;
    if (orderId !== ORDER_ID) {
      return Promise.reject(new OrderNotFoundError());
    }
    return Promise.resolve(sampleOrder(ownerId, orderId));
  }
}

function sampleOrder(ownerId: string, orderId: string): OrderRecord {
  const now = new Date('2026-08-22T10:00:00.000Z');
  return {
    id: orderId,
    userId: ownerId,
    status: OrderStatus.CONFIRMED,
    customerPhone: '+989121234567',
    regionId: REGION_ID,
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
    confirmedAt: now,
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: 'admin-only-reason',
    createdAt: now,
    updatedAt: now,
    lines: [
      {
        id: '77777777-7777-4777-8777-777777777777',
        orderId,
        productId: PRODUCT_ID,
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

describe('Orders read HTTP (ORD-04, e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let fakeRead: FakeOrderReadService;
  let userId: string;

  beforeAll(async () => {
    fakeRead = new FakeOrderReadService();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(OrderReadService)
      .useValue(fakeRead)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApplication(app);
    await app.init();
    server = app.getHttpServer() as Server;
  });

  beforeEach(() => {
    fakeRead.reset();
    userId = randomUUID();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated list and detail', async () => {
    const list = await request(server).get('/api/v1/orders').expect(401);
    expect((list.body as ApiErrorBody).error.code).toBe('AUTH_UNAUTHENTICATED');

    const detail = await request(server)
      .get(`/api/v1/orders/${ORDER_ID}`)
      .expect(401);
    expect((detail.body as ApiErrorBody).error.code).toBe(
      'AUTH_UNAUTHENTICATED',
    );
  });

  it('rejects ADMIN subjects on customer read routes', async () => {
    const token = signAccessToken(AuthSubjectType.ADMIN);
    await request(server)
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(fakeRead.lastOwnerId).toBeNull();

    await request(server)
      .get(`/api/v1/orders/${ORDER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(fakeRead.lastDetailId).toBeNull();
  });

  it('lists owned orders with principal-bound owner scope', async () => {
    const response = await request(server)
      .get(
        '/api/v1/orders?page=1&pageSize=10&status=PENDING_REVIEW&sortBy=total&sortOrder=asc&createdFrom=2026-08-01T00%3A00%3A00.000Z&createdTo=2026-08-31T23%3A59%3A59.999Z',
      )
      .set(
        'Authorization',
        `Bearer ${signAccessToken(AuthSubjectType.USER, userId)}`,
      )
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(fakeRead.lastOwnerId).toBe(userId);
    expect(fakeRead.lastListQuery).toMatchObject({
      page: 1,
      pageSize: 10,
      status: 'PENDING_REVIEW',
      sortBy: 'total',
      sortOrder: 'asc',
    });

    const body = response.body as {
      data: Array<Record<string, unknown>>;
      meta: Record<string, unknown>;
    };
    expect(body.meta).toMatchObject({ page: 1, pageSize: 10, total: 1 });
    expect(body.data[0]).toMatchObject({ id: ORDER_ID, total: 20_000 });
    expect(body.data[0]).not.toHaveProperty('lines');
  });

  it('returns owned order detail with historical snapshots', async () => {
    const response = await request(server)
      .get(`/api/v1/orders/${ORDER_ID}`)
      .set(
        'Authorization',
        `Bearer ${signAccessToken(AuthSubjectType.USER, userId)}`,
      )
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.body as { data: Record<string, unknown> };
    expect(body.data['regionName']).toBe('Historical Region');
    expect(body.data['lines']).toEqual([
      expect.objectContaining({
        productName: 'Historical Eggs',
        unitPrice: 10_000,
      }),
    ]);
    expect(body.data).not.toHaveProperty('cancelReason');
    expect(body.data['confirmedAt']).toBe('2026-08-22T10:00:00.000Z');
  });

  it('returns ORDER_NOT_FOUND for another customer order without leakage', async () => {
    const token = signAccessToken(AuthSubjectType.USER, userId);
    const ownMissing = await request(server)
      .get(`/api/v1/orders/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    const otherCustomer = await request(server)
      .get(`/api/v1/orders/${OTHER_ORDER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect((ownMissing.body as ApiErrorBody).error.code).toBe(
      'ORDER_NOT_FOUND',
    );
    expect((otherCustomer.body as ApiErrorBody).error.code).toBe(
      'ORDER_NOT_FOUND',
    );
    expect((ownMissing.body as ApiErrorBody).error.message).toBe(
      (otherCustomer.body as ApiErrorBody).error.message,
    );
  });

  it('rejects unknown query parameters and invalid pagination', async () => {
    const token = signAccessToken(AuthSubjectType.USER, userId);
    await request(server)
      .get('/api/v1/orders?userId=spoof')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await request(server)
      .get('/api/v1/orders?page=0')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await request(server)
      .get('/api/v1/orders?sortBy=updatedAt')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('documents Orders_list and Orders_get in OpenAPI', () => {
    const document = createOpenApiDocument(app);
    expect(document.paths['/api/v1/orders']?.get?.operationId).toBe(
      'Orders_list',
    );
    expect(document.paths['/api/v1/orders/{id}']?.get?.operationId).toBe(
      'Orders_get',
    );
  });
});

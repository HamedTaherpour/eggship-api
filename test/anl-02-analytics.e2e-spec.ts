import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { configureApplication } from '../src/app.setup';
import { createOpenApiDocument } from '../src/common/openapi/openapi.document';
import { ConfigModule } from '@nestjs/config';
import { createConfigModuleOptions } from '../src/config/config-module.options';
import { ObservabilityModule } from '../src/common/observability/observability.module';
import { AuthorizationModule } from '../src/common/authz/authorization.module';
import { AnalyticsModule } from '../src/modules/analytics/analytics.module';
import { AdminRole } from '../src/common/authz/admin-role';
import type {
  AdminAuthorizationLookup,
  AdminRoleResolver,
} from '../src/common/authz/admin-role-resolver';
import { ADMIN_ROLE_RESOLVER } from '../src/common/authz/authorization.tokens';
import { AuthSubjectType } from '../src/modules/auth/domain/subject-type';
import { AnalyticsRepository } from '../src/modules/analytics/infrastructure/analytics.repository';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';

jest.setTimeout(30_000);

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const INACTIVE_ID = '33333333-3333-4333-8333-333333333333';
const MISSING_INVENTORY_ID = '44444444-4444-4444-8444-444444444444';
const NO_HISTORY_ID = '55555555-5555-4555-8555-555555555555';

type AnalyticsRow = {
  id: string;
  name: string;
  price: number;
  isActive: boolean;
  createdAt: Date;
  inventory: { onHand: number; reserved: number; updatedAt: Date } | null;
};
type LedgerRow = {
  id: string;
  type: string;
  quantity: number;
  onHandDelta: number;
  createdAt: Date;
};
type DailyResponseBody = {
  data: { days: Array<{ received: number; adjustment: number }> };
};
type StockResponseBody = { data: Record<string, unknown> };
type PriceResponseBody = {
  data: {
    currentPrice: number;
    initialPrice: { price: number; inferred: boolean };
    priceAtRangeStart: { price: number; inferred: boolean } | null;
    changes: unknown[];
  };
};

class StubAnalyticsRepository {
  readonly rows: AnalyticsRow[] = [
    {
      id: PRODUCT_ID,
      name: 'Fresh eggs',
      price: 1400,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      inventory: {
        onHand: 12,
        reserved: 3,
        updatedAt: new Date('2026-01-03T00:00:00Z'),
      },
    },
    {
      id: INACTIVE_ID,
      name: 'Inactive eggs',
      price: 900,
      isActive: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      inventory: {
        onHand: 2,
        reserved: 0,
        updatedAt: new Date('2026-01-03T00:00:00Z'),
      },
    },
    {
      id: MISSING_INVENTORY_ID,
      name: 'Broken invariant',
      price: 500,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      inventory: null,
    },
    {
      id: NO_HISTORY_ID,
      name: 'No history eggs',
      price: 777,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      inventory: {
        onHand: 1,
        reserved: 0,
        updatedAt: new Date('2026-01-03T00:00:00Z'),
      },
    },
  ];
  readonly ledger: LedgerRow[] = [
    {
      id: randomUUID(),
      type: 'RECEIVE',
      quantity: 2,
      onHandDelta: 2,
      createdAt: new Date('2026-01-03T01:00:00Z'),
    },
  ];
  readonly prices = [
    {
      productId: PRODUCT_ID,
      id: randomUUID(),
      oldPrice: 1000,
      newPrice: 1200,
      createdAt: new Date('2026-01-02T20:00:00Z'),
    },
  ];
  findProductWithInventory(id: string): Promise<AnalyticsRow | null> {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }
  listLedgerFrom(): Promise<LedgerRow[]> {
    return Promise.resolve(this.ledger.filter((row) => row.type !== 'RESERVE'));
  }
  listPriceHistoryBefore(productId: string): Promise<typeof this.prices> {
    return Promise.resolve(
      this.prices.filter((price) => price.productId === productId),
    );
  }
}

class StubAdminRoleResolver implements AdminRoleResolver {
  role: AdminRole | undefined;
  findAdminAuthorization(adminId: string): Promise<AdminAuthorizationLookup> {
    return Promise.resolve(
      this.role === undefined
        ? { status: 'not_found' }
        : {
            status: 'found',
            record: { adminId, role: this.role, isActive: true },
          },
    );
  }
}

function token(subjectType: AuthSubjectType, subjectId = ADMIN_ID): string {
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

describe('ANL-02 analytics HTTP contract (e2e)', () => {
  let app: INestApplication;
  let repository: StubAnalyticsRepository;
  let roles: StubAdminRoleResolver;

  beforeAll(async () => {
    repository = new StubAnalyticsRepository();
    roles = new StubAdminRoleResolver();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        AuthorizationModule.forRoot({
          adminRoleResolver: { provide: ADMIN_ROLE_RESOLVER, useValue: roles },
        }),
        AnalyticsModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: (): void => undefined,
        onModuleDestroy: (): void => undefined,
      })
      .overrideProvider(AnalyticsRepository)
      .useValue(repository)
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });
  afterAll(async () => app.close());
  function server(): Server {
    return app.getHttpServer() as Server;
  }
  function route(id: string, suffix: string): string {
    return `/api/v1/admin/analytics/products/${id}/${suffix}`;
  }

  it('documents all three operations and requires ANALYTICS_READ', async () => {
    const doc = createOpenApiDocument(app);
    expect(
      doc.paths['/api/v1/admin/analytics/products/{productId}/stock']?.get,
    ).toBeDefined();
    expect(
      doc.paths['/api/v1/admin/analytics/products/{productId}/stock/daily']
        ?.get,
    ).toBeDefined();
    expect(
      doc.paths['/api/v1/admin/analytics/products/{productId}/price-history']
        ?.get,
    ).toBeDefined();
    await request(server()).get(route(PRODUCT_ID, 'stock')).expect(401);
    await request(server())
      .get(route(PRODUCT_ID, 'stock'))
      .set(
        'Authorization',
        `Bearer ${token(AuthSubjectType.USER, randomUUID())}`,
      )
      .expect(403);
    roles.role = AdminRole.WAREHOUSE;
    await request(server())
      .get(route(PRODUCT_ID, 'stock'))
      .set('Authorization', `Bearer ${token(AuthSubjectType.ADMIN)}`)
      .expect(403);
    roles.role = AdminRole.SUPER_ADMIN;
    await request(server())
      .get(route(PRODUCT_ID, 'stock'))
      .set('Authorization', `Bearer ${token(AuthSubjectType.ADMIN)}`)
      .expect(200);
  });

  it('serves current stock with inactive, missing, nonexistent, envelope, and privacy behavior', async () => {
    roles.role = AdminRole.SUPER_ADMIN;
    const response = await request(server())
      .get(route(PRODUCT_ID, 'stock'))
      .set('Authorization', `Bearer ${token(AuthSubjectType.ADMIN)}`)
      .expect(200);
    const stockBody = response.body as StockResponseBody;
    expect(stockBody.data).toMatchObject({
      productId: PRODUCT_ID,
      onHand: 12,
      reserved: 3,
      available: 9,
    });
    expect(stockBody.data).not.toHaveProperty('customerPhone');
    expect(response.headers['cache-control']).toBe('no-store');
    await request(server())
      .get(route(INACTIVE_ID, 'stock'))
      .set('Authorization', `Bearer ${token(AuthSubjectType.ADMIN)}`)
      .expect(200);
    await request(server())
      .get(route(MISSING_INVENTORY_ID, 'stock'))
      .set('Authorization', `Bearer ${token(AuthSubjectType.ADMIN)}`)
      .expect(500);
    await request(server())
      .get(route(randomUUID(), 'stock'))
      .set('Authorization', `Bearer ${token(AuthSubjectType.ADMIN)}`)
      .expect(404);
  });

  it('validates daily ranges strictly and returns one-day, multi-day, and sparse results', async () => {
    roles.role = AdminRole.SUPER_ADMIN;
    const auth = { Authorization: `Bearer ${token(AuthSubjectType.ADMIN)}` };
    const one = await request(server())
      .get(route(PRODUCT_ID, 'stock/daily'))
      .query({ from: '2026-01-01', to: '2026-01-01' })
      .set(auth)
      .expect(200);
    expect((one.body as DailyResponseBody).data.days).toHaveLength(1);
    const multi = await request(server())
      .get(route(PRODUCT_ID, 'stock/daily'))
      .query({ from: '2026-01-01', to: '2026-01-03' })
      .set(auth)
      .expect(200);
    const dailyBody = multi.body as DailyResponseBody;
    expect(dailyBody.data.days).toHaveLength(3);
    expect(dailyBody.data.days[1]).toMatchObject({
      received: 0,
      adjustment: 0,
    });
    await request(server())
      .get(route(PRODUCT_ID, 'stock/daily'))
      .query({ from: '2026-01-01', to: '2027-01-02' })
      .set(auth)
      .expect(400);
    await request(server())
      .get(route(PRODUCT_ID, 'stock/daily'))
      .query({ from: '2026-01-01', to: '2026-01-01', unknown: 'x' })
      .set(auth)
      .expect(400);
    await request(server())
      .get(route(PRODUCT_ID, 'stock/daily'))
      .query({ from: 'not-a-date', to: '2026-01-01' })
      .set(auth)
      .expect(400);
  });

  it('returns current price, inferred initial anchor, actual changes, inactive products, and 404s', async () => {
    roles.role = AdminRole.SUPER_ADMIN;
    const auth = { Authorization: `Bearer ${token(AuthSubjectType.ADMIN)}` };
    const response = await request(server())
      .get(route(PRODUCT_ID, 'price-history'))
      .query({ from: '2026-01-03', to: '2026-01-04' })
      .set(auth)
      .expect(200);
    const priceBody = response.body as PriceResponseBody;
    expect(priceBody.data).toMatchObject({
      currentPrice: 1400,
      initialPrice: { price: 1000, inferred: true },
      priceAtRangeStart: { price: 1200, inferred: false },
    });
    expect(priceBody.data.changes).toHaveLength(0);
    await request(server())
      .get(route(INACTIVE_ID, 'price-history'))
      .query({ from: '2026-01-01', to: '2026-01-03' })
      .set(auth)
      .expect(200);
    const noHistory = await request(server())
      .get(route(NO_HISTORY_ID, 'price-history'))
      .query({ from: '2026-01-01', to: '2026-01-03' })
      .set(auth)
      .expect(200);
    expect((noHistory.body as PriceResponseBody).data).toMatchObject({
      currentPrice: 777,
      initialPrice: { price: 777, inferred: true },
      changes: [],
    });
    await request(server())
      .get(route(randomUUID(), 'price-history'))
      .query({ from: '2026-01-01', to: '2026-01-03' })
      .set(auth)
      .expect(404);
  });
});

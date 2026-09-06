import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { postgresIntegrationImports } from '../support/postgres-testing-module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../../src/modules/auth/domain/authenticated-principal';
import { AuthSubjectType } from '../../../src/modules/auth/domain/subject-type';
import { CategoryRepository } from '../../../src/modules/categories/infrastructure/category.repository';
import { InventoryModule } from '../../../src/modules/inventory/inventory.module';
import {
  PricingService,
  type ChangeProductPriceResult,
} from '../../../src/modules/pricing/application/pricing.service';
import { PriceHistoryRepository } from '../../../src/modules/pricing/infrastructure/price-history.repository';
import { PriceHistoryActorType } from '../../../src/modules/pricing/domain/price-history-actor';
import {
  PRODUCT_PRICE_MAX_TOMAN,
  PRODUCT_PRICE_MIN_TOMAN,
} from '../../../src/modules/products/domain/product-price';
import {
  ProductInvalidCategoryError,
  ProductNotFoundError,
} from '../../../src/modules/products/domain/product-errors';
import { ProductService } from '../../../src/modules/products/application/product.service';
import { ProductRepository } from '../../../src/modules/products/infrastructure/product.repository';
import { ProductsModule } from '../../../src/modules/products/products.module';
import { PricingModule } from '../../../src/modules/pricing/pricing.module';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';
import { AuditLogService } from '../../../src/modules/audit/application/audit-log.service';
import { AuditAction } from '../../../src/modules/audit/domain/audit-event';

const ADMIN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const adminPrincipal: AuthenticatedPrincipal = {
  subjectId: ADMIN_ID,
  subjectType: AuthSubjectType.ADMIN,
  sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};

async function truncatePricingTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "PriceHistory", "InventoryLedger", "InventoryReservation", "Inventory", "Product", "Category" RESTART IDENTITY CASCADE',
  );
}

describe('Product price history (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let categories: CategoryRepository;
  let products: ProductRepository;
  let priceHistory: PriceHistoryRepository;
  let pricing: PricingService;
  let productService: ProductService;
  let audit: AuditLogService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ...postgresIntegrationImports([
          InventoryModule,
          ProductsModule,
          PricingModule,
        ]),
      ],
      providers: [CategoryRepository],
    }).compile();

    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    categories = moduleRef.get(CategoryRepository);
    products = moduleRef.get(ProductRepository);
    priceHistory = moduleRef.get(PriceHistoryRepository);
    pricing = moduleRef.get(PricingService);
    productService = moduleRef.get(ProductService);
    audit = moduleRef.get(AuditLogService);
    await app.init();
  });

  beforeEach(async () => {
    await truncatePricingTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('does not write history on product creation', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const created = await products.create({
      name: 'Fresh eggs',
      price: 625000,
      categoryId: category.id,
    });

    expect(await priceHistory.countByProductId(created.id)).toBe(0);
  });

  it('writes exactly one history row on the first price change with correct old/new values', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const created = await products.create({
      name: 'Fresh eggs',
      price: 625000,
      categoryId: category.id,
    });

    const result = await pricing.changeProductPrice({
      productId: created.id,
      newPrice: 650000,
      actor: { type: PriceHistoryActorType.ADMIN, id: ADMIN_ID },
    });

    expect(result.historyWritten).toBe(true);
    expect(result.product.price).toBe(650000);

    const rows = await priceHistory.listByProductId(created.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      productId: created.id,
      oldPrice: 625000,
      newPrice: 650000,
      actorType: PriceHistoryActorType.ADMIN,
      actorId: ADMIN_ID,
    });
    expect(rows[0]!.createdAt).toBeInstanceOf(Date);
    const audits = await prisma.auditLog.findMany({
      where: { action: AuditAction.PRICE_CHANGED, entityId: created.id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: 'ADMIN',
      actorId: ADMIN_ID,
      entityType: 'PRODUCT',
      metadata: { previousPrice: 625000, newPrice: 650000 },
    });
  });

  it('persists createdAt from the PostgreSQL transaction clock', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const created = await products.create({
      name: 'Fresh eggs',
      price: 625000,
      categoryId: category.id,
    });
    const before = await prisma.$queryRaw<Array<{ now: Date }>>`
      SELECT CURRENT_TIMESTAMP AS now
    `;

    await pricing.changeProductPrice({
      productId: created.id,
      newPrice: 650000,
      actor: { type: PriceHistoryActorType.ADMIN, id: ADMIN_ID },
    });

    const after = await prisma.$queryRaw<Array<{ now: Date }>>`
      SELECT CURRENT_TIMESTAMP AS now
    `;
    const row = await prisma.priceHistory.findFirstOrThrow({
      where: { productId: created.id },
    });
    expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(
      before[0]!.now.getTime() - 5,
    );
    expect(row.createdAt.getTime()).toBeLessThanOrEqual(
      after[0]!.now.getTime() + 5,
    );
  });

  it('skips history for a no-op admin price update', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const created = await products.create({
      name: 'Fresh eggs',
      price: 625000,
      categoryId: category.id,
    });

    const result = await productService.update(
      created.id,
      { price: 625000 },
      adminPrincipal,
    );

    expect(result.price).toBe(625000);
    expect(await priceHistory.countByProductId(created.id)).toBe(0);
  });

  it('creates no history when a non-price update fails validation before mutation', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const created = await products.create({
      name: 'Fresh eggs',
      price: 625000,
      categoryId: category.id,
    });

    await expect(
      productService.update(
        created.id,
        { price: 700000, categoryId: randomUUID() },
        adminPrincipal,
      ),
    ).rejects.toBeInstanceOf(ProductInvalidCategoryError);

    expect((await products.findById(created.id))!.price).toBe(625000);
    expect(await priceHistory.countByProductId(created.id)).toBe(0);
  });

  it('throws PRODUCT_NOT_FOUND without history when the product id is missing', async () => {
    await expect(
      pricing.changeProductPrice({
        productId: randomUUID(),
        newPrice: 650000,
        actor: { type: PriceHistoryActorType.ADMIN, id: ADMIN_ID },
      }),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('rejects non-positive and overflow Toman values at the application layer', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const created = await products.create({
      name: 'Fresh eggs',
      price: 625000,
      categoryId: category.id,
    });

    await expect(
      pricing.changeProductPrice({
        productId: created.id,
        newPrice: 0,
        actor: { type: PriceHistoryActorType.ADMIN, id: ADMIN_ID },
      }),
    ).rejects.toThrow(/Toman/u);

    await expect(
      pricing.changeProductPrice({
        productId: created.id,
        newPrice: PRODUCT_PRICE_MAX_TOMAN + 1,
        actor: { type: PriceHistoryActorType.ADMIN, id: ADMIN_ID },
      }),
    ).rejects.toThrow(/Toman/u);

    expect(await priceHistory.countByProductId(created.id)).toBe(0);
    expect((await products.findById(created.id))!.price).toBe(625000);
    expect(PRODUCT_PRICE_MIN_TOMAN).toBe(1);
  });

  it('serializes concurrent price updates into a coherent history chain', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const created = await products.create({
      name: 'Fresh eggs',
      price: 1000,
      categoryId: category.id,
    });

    const outcomes = await Promise.allSettled([
      pricing.changeProductPrice({
        productId: created.id,
        newPrice: 1100,
        actor: { type: PriceHistoryActorType.ADMIN, id: ADMIN_ID },
      }),
      pricing.changeProductPrice({
        productId: created.id,
        newPrice: 1200,
        actor: { type: PriceHistoryActorType.ADMIN, id: ADMIN_ID },
      }),
      pricing.changeProductPrice({
        productId: created.id,
        newPrice: 1300,
        actor: { type: PriceHistoryActorType.ADMIN, id: ADMIN_ID },
      }),
    ]);

    const fulfilled = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<ChangeProductPriceResult> =>
        outcome.status === 'fulfilled',
    );
    expect(fulfilled.length).toBe(3);

    const finalProduct = await products.findById(created.id);
    expect(finalProduct!.price).toBeGreaterThan(1000);

    const rows = await priceHistory.listByProductId(created.id);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.oldPrice).toBe(1000);
    for (let index = 1; index < rows.length; index += 1) {
      expect(rows[index]!.oldPrice).toBe(rows[index - 1]!.newPrice);
    }
    expect(rows.at(-1)!.newPrice).toBe(finalProduct!.price);
    expect(
      await prisma.auditLog.count({
        where: { action: AuditAction.PRICE_CHANGED, entityId: created.id },
      }),
    ).toBe(3);
  });

  it('rolls back Product price and PriceHistory when required audit append fails', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const created = await products.create({
      name: 'Failure eggs',
      price: 625000,
      categoryId: category.id,
    });
    jest
      .spyOn(audit, 'append')
      .mockRejectedValueOnce(new Error('audit failure'));

    await expect(
      pricing.changeProductPrice({
        productId: created.id,
        newPrice: 650000,
        actor: { type: PriceHistoryActorType.ADMIN, id: ADMIN_ID },
      }),
    ).rejects.toThrow('audit failure');

    expect((await products.findById(created.id))!.price).toBe(625000);
    expect(await priceHistory.countByProductId(created.id)).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { action: AuditAction.PRICE_CHANGED, entityId: created.id },
      }),
    ).toBe(0);
    jest.restoreAllMocks();
  });

  it('blocks Product deletion while PriceHistory rows exist', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const created = await products.create({
      name: 'Fresh eggs',
      price: 625000,
      categoryId: category.id,
    });

    await pricing.changeProductPrice({
      productId: created.id,
      newPrice: 650000,
      actor: { type: PriceHistoryActorType.ADMIN, id: ADMIN_ID },
    });

    await expect(
      prisma.product.delete({ where: { id: created.id } }),
    ).rejects.toThrow();
  });
});

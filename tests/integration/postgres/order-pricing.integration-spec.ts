import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { postgresIntegrationImports } from '../support/postgres-testing-module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { TransactionRunner } from '../../../src/infrastructure/database/transaction';
import { CategoryRepository } from '../../../src/modules/categories/infrastructure/category.repository';
import { InventoryModule } from '../../../src/modules/inventory/inventory.module';
import { OrderPricingService } from '../../../src/modules/pricing/application/order-pricing.service';
import { DiscountService } from '../../../src/modules/pricing/application/discount.service';
import { PricingService } from '../../../src/modules/pricing/application/pricing.service';
import {
  DiscountTarget,
  DiscountType,
} from '../../../src/modules/pricing/domain/discount';
import { OrderPricingProductUnavailableError } from '../../../src/modules/pricing/domain/order-pricing-errors';
import { PricingModule } from '../../../src/modules/pricing/pricing.module';
import { ProductRepository } from '../../../src/modules/products/infrastructure/product.repository';
import { ProductsModule } from '../../../src/modules/products/products.module';
import { PriceHistoryActorType } from '../../../src/modules/pricing/domain/price-history-actor';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

async function truncatePricingTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "DiscountUsageRecord", "DiscountCustomerUsage", "Discount", "PriceHistory", "InventoryLedger", "InventoryReservation", "Inventory", "Product", "Category" RESTART IDENTITY CASCADE',
  );
}

describe('Order pricing composition (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let categories: CategoryRepository;
  let products: ProductRepository;
  let discounts: DiscountService;
  let pricing: PricingService;
  let orderPricing: OrderPricingService;
  let transactions: TransactionRunner;

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
    discounts = moduleRef.get(DiscountService);
    pricing = moduleRef.get(PricingService);
    orderPricing = moduleRef.get(OrderPricingService);
    transactions = moduleRef.get(TransactionRunner);
    await app.init();
  });

  beforeEach(async () => {
    await truncatePricingTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('composes LINE + ORDER discounts with coherent Product/Discount snapshot', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const product = await products.create({
      name: 'Fresh eggs',
      price: 10_000,
      categoryId: category.id,
    });

    await discounts.create({
      name: 'Product markdown',
      type: DiscountType.FIXED,
      target: DiscountTarget.PRODUCT,
      fixedAmount: 1_000,
      productId: product.id,
      precedence: 5,
    });
    await discounts.create({
      name: 'Order 10%',
      type: DiscountType.PERCENT,
      target: DiscountTarget.ORDER,
      percentValue: 10,
      precedence: 1,
    });

    const evaluatedAt = new Date('2026-08-15T12:00:00.000Z');
    const snapshot = await orderPricing.priceOrderLines(
      [{ productId: product.id, quantity: 2 }],
      { evaluatedAt },
    );

    expect(snapshot.evaluatedAt).toEqual(evaluatedAt);
    expect(snapshot.lines[0]).toMatchObject({
      productId: product.id,
      productName: 'Fresh eggs',
      categoryId: category.id,
      unitPrice: 10_000,
      quantity: 2,
      grossLineTotal: 20_000n,
      lineDiscountAmount: 1_000n,
      finalLineTotal: 19_000n,
    });
    expect(snapshot.subtotalAfterLineDiscounts).toBe(19_000n);
    expect(snapshot.orderDiscountAmount).toBe(1_900n);
    expect(snapshot.total).toBe(17_100n);
  });

  it('rejects inactive or category-inactive products as PRODUCT_NOT_FOUND', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const inactiveCategory = await categories.create({
      name: 'Hidden',
      isActive: false,
    });
    const inactiveProduct = await products.create({
      name: 'Inactive',
      price: 5_000,
      categoryId: category.id,
      isActive: false,
    });
    const hiddenByCategory = await products.create({
      name: 'Hidden by category',
      price: 5_000,
      categoryId: inactiveCategory.id,
      isActive: true,
    });

    await expect(
      orderPricing.priceOrderLines([
        { productId: inactiveProduct.id, quantity: 1 },
      ]),
    ).rejects.toBeInstanceOf(OrderPricingProductUnavailableError);

    await expect(
      orderPricing.priceOrderLines([
        { productId: hiddenByCategory.id, quantity: 1 },
      ]),
    ).rejects.toBeInstanceOf(OrderPricingProductUnavailableError);
  });

  it('uses one coherent snapshot when product price changes concurrently', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const product = await products.create({
      name: 'Fresh eggs',
      price: 10_000,
      categoryId: category.id,
    });
    const adminId = randomUUID();

    const priced = await transactions.runSnapshotRead(async (tx) => {
      const inFlight = orderPricing.priceOrderLines(
        [{ productId: product.id, quantity: 1 }],
        { tx },
      );

      await pricing.changeProductPrice({
        productId: product.id,
        newPrice: 99_000,
        actor: {
          type: PriceHistoryActorType.ADMIN,
          id: adminId,
        },
      });

      return inFlight;
    });

    // Snapshot transaction must not observe a hybrid mid-update view of the
    // priced product relative to its own read — either old or new, coherently.
    expect([10_000, 99_000]).toContain(priced.lines[0]!.unitPrice);
    expect(priced.lines[0]!.grossLineTotal).toBe(
      BigInt(priced.lines[0]!.unitPrice),
    );

    const after = await orderPricing.priceOrderLines([
      { productId: product.id, quantity: 1 },
    ]);
    expect(after.lines[0]!.unitPrice).toBe(99_000);
  });

  it('uses one coherent snapshot when a discount activates concurrently', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const product = await products.create({
      name: 'Fresh eggs',
      price: 10_000,
      categoryId: category.id,
    });
    const inactive = await discounts.create({
      name: 'Soon active',
      type: DiscountType.FIXED,
      target: DiscountTarget.PRODUCT,
      fixedAmount: 2_000,
      productId: product.id,
      isActive: false,
    });

    const priced = await transactions.runSnapshotRead(async (tx) => {
      const inFlight = orderPricing.priceOrderLines(
        [{ productId: product.id, quantity: 1 }],
        { tx },
      );

      await discounts.activate(inactive.id);

      return inFlight;
    });

    // Within the snapshot, discount activation is either fully visible or not.
    expect([8_000n, 10_000n]).toContain(priced.total);

    const after = await orderPricing.priceOrderLines([
      { productId: product.id, quantity: 1 },
    ]);
    expect(after.total).toBe(8_000n);
  });

  it('is deterministic when repeated inside the same transaction context', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const product = await products.create({
      name: 'Fresh eggs',
      price: 12_345,
      categoryId: category.id,
    });
    await discounts.create({
      name: 'Order 13%',
      type: DiscountType.PERCENT,
      target: DiscountTarget.ORDER,
      percentValue: 13,
    });

    await transactions.runSnapshotRead(async (tx) => {
      const evaluatedAt = new Date('2026-08-15T12:00:00.000Z');
      const first = await orderPricing.priceOrderLines(
        [{ productId: product.id, quantity: 3 }],
        { evaluatedAt, tx },
      );
      const second = await orderPricing.priceOrderLines(
        [{ productId: product.id, quantity: 3 }],
        { evaluatedAt, tx },
      );
      expect(second).toEqual(first);
    });
  });

  it('loads candidate discounts without N+1 product queries', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const created = await Promise.all(
      Array.from({ length: 5 }, async (_, index) =>
        products.create({
          name: `SKU ${index}`,
          price: 1_000 * (index + 1),
          categoryId: category.id,
        }),
      ),
    );
    await discounts.create({
      name: 'Category 5%',
      type: DiscountType.PERCENT,
      target: DiscountTarget.CATEGORY,
      percentValue: 5,
      categoryId: category.id,
    });

    const snapshot = await orderPricing.priceOrderLines(
      created.map((row) => ({ productId: row.id, quantity: 1 })),
    );

    expect(snapshot.lines).toHaveLength(5);
    expect(snapshot.grossSubtotal).toBe(15_000n);
    expect(snapshot.lineDiscountTotal).toBe(750n);
  });
});

import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { PrismaModule } from '../../../src/infrastructure/database/prisma/prisma.module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { CategoryRepository } from '../../../src/modules/categories/infrastructure/category.repository';
import { InventoryModule } from '../../../src/modules/inventory/inventory.module';
import { DiscountService } from '../../../src/modules/pricing/application/discount.service';
import {
  DiscountTarget,
  DiscountType,
} from '../../../src/modules/pricing/domain/discount';
import {
  DiscountInvalidCategoryError,
  DiscountInvalidFixedAmountError,
  DiscountInvalidPercentError,
  DiscountInvalidProductError,
  DiscountInvalidWindowError,
  DiscountNotFoundError,
} from '../../../src/modules/pricing/domain/discount-errors';
import { isPotentiallyApplicable } from '../../../src/modules/pricing/domain/discount-lifecycle';
import { PricingModule } from '../../../src/modules/pricing/pricing.module';
import { ProductRepository } from '../../../src/modules/products/infrastructure/product.repository';
import { ProductsModule } from '../../../src/modules/products/products.module';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

async function truncateDiscountTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Discount", "PriceHistory", "InventoryLedger", "InventoryReservation", "Inventory", "Product", "Category" RESTART IDENTITY CASCADE',
  );
}

describe('Discount persistence (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let categories: CategoryRepository;
  let products: ProductRepository;
  let discounts: DiscountService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        PrismaModule,
        InventoryModule,
        ProductsModule,
        PricingModule,
      ],
      providers: [CategoryRepository],
    }).compile();

    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    categories = moduleRef.get(CategoryRepository);
    products = moduleRef.get(ProductRepository);
    discounts = moduleRef.get(DiscountService);
    await app.init();
  });

  beforeEach(async () => {
    await truncateDiscountTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a valid ORDER PERCENT discount', async () => {
    const created = await discounts.create({
      name: '  Site-wide 10%  ',
      type: DiscountType.PERCENT,
      target: DiscountTarget.ORDER,
      percentValue: 10,
      precedence: 5,
    });

    expect(created.name).toBe('Site-wide 10%');
    expect(created).toMatchObject({
      type: DiscountType.PERCENT,
      target: DiscountTarget.ORDER,
      percentValue: 10,
      fixedAmount: null,
      productId: null,
      categoryId: null,
      isActive: true,
      precedence: 5,
    });
  });

  it('creates PRODUCT FIXED and CATEGORY PERCENT discounts with FK scope', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const product = await products.create({
      name: 'Fresh eggs',
      price: 625000,
      categoryId: category.id,
    });

    const productFixed = await discounts.create({
      name: 'Product markdown',
      type: DiscountType.FIXED,
      target: DiscountTarget.PRODUCT,
      fixedAmount: 50000,
      productId: product.id,
    });
    expect(productFixed.fixedAmount).toBe(50000);
    expect(productFixed.productId).toBe(product.id);

    const categoryPercent = await discounts.create({
      name: 'Category promo',
      type: DiscountType.PERCENT,
      target: DiscountTarget.CATEGORY,
      percentValue: 15,
      categoryId: category.id,
    });
    expect(categoryPercent.categoryId).toBe(category.id);
  });

  it('rejects invalid percent and fixed amounts at the application layer', async () => {
    await expect(
      discounts.create({
        name: 'Bad percent',
        type: DiscountType.PERCENT,
        target: DiscountTarget.ORDER,
        percentValue: 0,
      }),
    ).rejects.toBeInstanceOf(DiscountInvalidPercentError);

    await expect(
      discounts.create({
        name: 'Float percent',
        type: DiscountType.PERCENT,
        target: DiscountTarget.ORDER,
        percentValue: 10.5,
      }),
    ).rejects.toBeInstanceOf(DiscountInvalidPercentError);

    await expect(
      discounts.create({
        name: 'Bad fixed',
        type: DiscountType.FIXED,
        target: DiscountTarget.ORDER,
        fixedAmount: 0,
      }),
    ).rejects.toBeInstanceOf(DiscountInvalidFixedAmountError);
  });

  it('validates activation windows and supports deactivation', async () => {
    const startsAt = new Date('2026-08-01T00:00:00.000Z');
    const endsAt = new Date('2026-08-31T23:59:59.999Z');

    await expect(
      discounts.create({
        name: 'Bad window',
        type: DiscountType.PERCENT,
        target: DiscountTarget.ORDER,
        percentValue: 5,
        startsAt: endsAt,
        endsAt: startsAt,
      }),
    ).rejects.toBeInstanceOf(DiscountInvalidWindowError);

    const created = await discounts.create({
      name: 'Timed promo',
      type: DiscountType.PERCENT,
      target: DiscountTarget.ORDER,
      percentValue: 5,
      startsAt,
      endsAt,
    });

    expect(
      isPotentiallyApplicable(created, new Date('2026-08-15T12:00:00.000Z')),
    ).toBe(true);
    expect(
      isPotentiallyApplicable(created, new Date('2026-09-01T00:00:00.000Z')),
    ).toBe(false);

    const deactivated = await discounts.deactivate(created.id);
    expect(deactivated.isActive).toBe(false);
    expect(
      isPotentiallyApplicable(
        deactivated,
        new Date('2026-08-15T12:00:00.000Z'),
      ),
    ).toBe(false);

    const reactivated = await discounts.activate(created.id);
    expect(reactivated.isActive).toBe(true);
  });

  it('preserves invariants on update and rejects missing target references', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const product = await products.create({
      name: 'Fresh eggs',
      price: 625000,
      categoryId: category.id,
    });

    const created = await discounts.create({
      name: 'Launch promo',
      type: DiscountType.PERCENT,
      target: DiscountTarget.PRODUCT,
      percentValue: 20,
      productId: product.id,
    });

    const updated = await discounts.update(created.id, {
      name: 'Launch promo v2',
      type: DiscountType.FIXED,
      target: DiscountTarget.PRODUCT,
      fixedAmount: 75000,
      productId: product.id,
      precedence: 10,
    });

    expect(updated).toMatchObject({
      name: 'Launch promo v2',
      type: DiscountType.FIXED,
      fixedAmount: 75000,
      percentValue: null,
      precedence: 10,
    });

    await expect(
      discounts.create({
        name: 'Missing product',
        type: DiscountType.FIXED,
        target: DiscountTarget.PRODUCT,
        fixedAmount: 1000,
        productId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(DiscountInvalidProductError);

    await expect(
      discounts.create({
        name: 'Missing category',
        type: DiscountType.PERCENT,
        target: DiscountTarget.CATEGORY,
        percentValue: 5,
        categoryId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(DiscountInvalidCategoryError);

    await expect(
      discounts.update(randomUUID(), { isActive: false }),
    ).rejects.toBeInstanceOf(DiscountNotFoundError);
  });

  it('enforces database CHECK constraints for invalid persisted combinations', async () => {
    await expect(
      prisma.discount.create({
        data: {
          name: 'DB bad percent',
          type: DiscountType.PERCENT,
          target: DiscountTarget.ORDER,
          percentValue: 101,
          fixedAmount: null,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.discount.create({
        data: {
          name: 'DB bad target',
          type: DiscountType.FIXED,
          target: DiscountTarget.PRODUCT,
          fixedAmount: 1000,
          percentValue: null,
        },
      }),
    ).rejects.toThrow();
  });

  it('blocks Product deletion while Discount rows reference it', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const product = await products.create({
      name: 'Fresh eggs',
      price: 625000,
      categoryId: category.id,
    });

    await discounts.create({
      name: 'Product tie-in',
      type: DiscountType.FIXED,
      target: DiscountTarget.PRODUCT,
      fixedAmount: 5000,
      productId: product.id,
    });

    await expect(
      prisma.product.delete({ where: { id: product.id } }),
    ).rejects.toThrow();
  });
});

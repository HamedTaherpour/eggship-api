import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { PrismaModule } from '../../../src/infrastructure/database/prisma/prisma.module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { CategoryService } from '../../../src/modules/categories/application/category.service';
import { CategoryRepository } from '../../../src/modules/categories/infrastructure/category.repository';
import { InventoryModule } from '../../../src/modules/inventory/inventory.module';
import { InventoryService } from '../../../src/modules/inventory/application/inventory.service';
import { ProductService } from '../../../src/modules/products/application/product.service';
import { ProductRepository } from '../../../src/modules/products/infrastructure/product.repository';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

async function truncateProductTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "InventoryLedger", "InventoryReservation", "Inventory", "Product", "Category" RESTART IDENTITY CASCADE',
  );
}

describe('Product catalog persistence (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let categories: CategoryRepository;
  let products: ProductRepository;
  let productService: ProductService;
  let inventory: InventoryService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        PrismaModule,
        InventoryModule,
      ],
      providers: [
        CategoryRepository,
        CategoryService,
        ProductRepository,
        ProductService,
      ],
    }).compile();

    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    categories = moduleRef.get(CategoryRepository);
    products = moduleRef.get(ProductRepository);
    productService = moduleRef.get(ProductService);
    inventory = moduleRef.get(InventoryService);
    await app.init();
  });

  beforeEach(async () => {
    await truncateProductTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates, reads, and updates products with integer Toman price', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const created = await products.create({
      name: '  Fresh eggs  ',
      price: 625000,
      categoryId: category.id,
    });

    expect(created).toMatchObject({
      name: 'Fresh eggs',
      price: 625000,
      categoryId: category.id,
      isActive: true,
    });
    expect(await products.findById(created.id)).toMatchObject({
      id: created.id,
      price: 625000,
    });

    const updated = await products.update(created.id, { price: 650000 });
    expect(updated).toMatchObject({ price: 650000 });
  });

  it('enforces Category FK and positive price CHECK', async () => {
    await expect(
      prisma.product.create({
        data: {
          name: 'Orphan',
          price: 1000,
          categoryId: randomUUID(),
        },
      }),
    ).rejects.toThrow();

    const category = await categories.create({ name: 'Eggs' });
    await expect(
      prisma.product.create({
        data: {
          name: 'Free',
          price: 0,
          categoryId: category.id,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.product.create({
        data: {
          name: 'Negative',
          price: -1,
          categoryId: category.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('hides inactive products and products under inactive categories from public queries', async () => {
    const activeCategory = await categories.create({ name: 'Active' });
    const inactiveCategory = await categories.create({
      name: 'Inactive',
      isActive: false,
    });

    const visible = await products.create({
      name: 'Visible',
      price: 1000,
      categoryId: activeCategory.id,
    });
    await products.create({
      name: 'Inactive product',
      price: 1000,
      categoryId: activeCategory.id,
      isActive: false,
    });
    await products.create({
      name: 'Under inactive category',
      price: 1000,
      categoryId: inactiveCategory.id,
    });

    const publicPage = await productService.listPublic({
      page: 1,
      pageSize: 20,
    });
    expect(publicPage.data.map((row) => row.id)).toEqual([visible.id]);

    expect(await products.findPublicById(visible.id)).not.toBeNull();
    expect(
      await products.findPublicById(
        (
          await products.list({
            page: 1,
            pageSize: 10,
            sortBy: 'name',
            sortOrder: 'asc',
            isActive: false,
          })
        ).items[0]!.id,
      ),
    ).toBeNull();
  });

  it('filters by category, searches name, sorts, and paginates', async () => {
    const eggs = await categories.create({ name: 'Eggs' });
    const dairy = await categories.create({ name: 'Dairy' });

    await products.create({
      name: 'Alpha eggs',
      price: 1000,
      categoryId: eggs.id,
    });
    await products.create({
      name: 'Beta eggs',
      price: 3000,
      categoryId: eggs.id,
    });
    await products.create({
      name: 'Milk',
      price: 2000,
      categoryId: dairy.id,
    });

    const page = await products.list({
      page: 1,
      pageSize: 1,
      search: 'eggs',
      sortBy: 'price',
      sortOrder: 'desc',
      categoryId: eggs.id,
      isActive: true,
    });

    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ name: 'Beta eggs', price: 3000 });
  });

  it('RESTRICT prevents deleting a Category that still has Products', async () => {
    const category = await categories.create({ name: 'Eggs' });
    await products.create({
      name: 'Linked',
      price: 1000,
      categoryId: category.id,
    });

    await expect(
      prisma.category.delete({ where: { id: category.id } }),
    ).rejects.toThrow();
  });

  it('allows duplicate product names (no uniqueness evidenced)', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const first = await products.create({
      name: 'Eggs',
      price: 1000,
      categoryId: category.id,
    });
    const second = await products.create({
      name: 'Eggs',
      price: 2000,
      categoryId: category.id,
    });
    expect(first.id).not.toBe(second.id);
  });

  it('list queries do not N+1 Category rows (single count + findMany)', async () => {
    const category = await categories.create({ name: 'Eggs' });
    for (let i = 0; i < 5; i += 1) {
      await products.create({
        name: `Product ${i}`,
        price: 1000 + i,
        categoryId: category.id,
      });
    }

    let findManyCalls = 0;
    let countCalls = 0;
    const originalFindMany = prisma.product.findMany.bind(prisma.product);
    const originalCount = prisma.product.count.bind(prisma.product);
    prisma.product.findMany = ((...args: unknown[]) => {
      findManyCalls += 1;
      return originalFindMany(...(args as Parameters<typeof originalFindMany>));
    }) as typeof prisma.product.findMany;
    prisma.product.count = ((...args: unknown[]) => {
      countCalls += 1;
      return originalCount(...(args as Parameters<typeof originalCount>));
    }) as typeof prisma.product.count;

    try {
      await products.list({
        page: 1,
        pageSize: 10,
        sortBy: 'name',
        sortOrder: 'asc',
        isActive: true,
        requireActiveCategory: true,
      });
      expect(findManyCalls).toBe(1);
      expect(countCalls).toBe(1);
    } finally {
      prisma.product.findMany = originalFindMany;
      prisma.product.count = originalCount;
    }
  });

  it('creates a 0/0 Inventory row in the same transaction as Product create', async () => {
    const category = await categories.create({ name: 'Eggs' });
    const created = await productService.create({
      name: 'Stocked',
      price: 1000,
      categoryId: category.id,
    });

    const balance = await inventory.getBalance(created.id);
    expect(balance).toMatchObject({
      productId: created.id,
      onHand: 0,
      reserved: 0,
      available: 0,
    });
  });
});

import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { PrismaModule } from '../../../src/infrastructure/database/prisma/prisma.module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { CategoryRepository } from '../../../src/modules/categories/infrastructure/category.repository';
import { CategoryService } from '../../../src/modules/categories/application/category.service';
import { AdminInventoryOperationsService } from '../../../src/modules/inventory/application/admin-inventory-operations.service';
import {
  InventoryService,
  SYSTEM_ACTOR,
} from '../../../src/modules/inventory/application/inventory.service';
import {
  IdempotencyConflictError,
  InventoryInvalidQuantityError,
} from '../../../src/modules/inventory/domain/inventory-errors';
import { InventoryHttpMessage } from '../../../src/modules/inventory/domain/inventory-http-messages';
import { InventoryModule } from '../../../src/modules/inventory/inventory.module';
import { ProductService } from '../../../src/modules/products/application/product.service';
import { ProductRepository } from '../../../src/modules/products/infrastructure/product.repository';
import { AuthSubjectType } from '../../../src/modules/auth/domain/subject-type';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

async function truncateInventoryTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "InventoryCommandIdempotency", "InventoryLedger", "InventoryReservation", "Inventory", "Product", "Category" RESTART IDENTITY CASCADE',
  );
}

describe('Admin inventory operations (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let categories: CategoryRepository;
  let productService: ProductService;
  let inventoryOps: AdminInventoryOperationsService;
  let inventory: InventoryService;

  const adminPrincipal = {
    subjectId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    subjectType: AuthSubjectType.ADMIN,
    sessionId: randomUUID(),
  };

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
    productService = moduleRef.get(ProductService);
    inventoryOps = moduleRef.get(AdminInventoryOperationsService);
    inventory = moduleRef.get(InventoryService);
    await app.init();
  });

  beforeEach(async () => {
    await truncateInventoryTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createProduct(): Promise<string> {
    const category = await categories.create({ name: `Cat ${randomUUID()}` });
    const product = await productService.create({
      name: `Eggs ${randomUUID()}`,
      price: 1000,
      categoryId: category.id,
    });
    return product.id;
  }

  it('receives stock atomically with ledger and idempotent replay', async () => {
    const productId = await createProduct();
    const idempotencyKey = randomUUID();

    const first = await inventoryOps.receiveStock({
      productId,
      quantity: 500,
      idempotencyKey,
      principal: adminPrincipal,
    });
    expect(first).toMatchObject({
      onHand: 500,
      reserved: 0,
      available: 500,
    });

    const replay = await inventoryOps.receiveStock({
      productId,
      quantity: 500,
      idempotencyKey,
      principal: adminPrincipal,
    });
    expect(replay.onHand).toBe(500);

    expect(
      await prisma.inventoryLedger.count({
        where: { productId, type: 'RECEIVE' },
      }),
    ).toBe(1);
    expect(await prisma.inventoryCommandIdempotency.count()).toBe(1);
  });

  it('adjusts stock by signed delta and rejects below reserved', async () => {
    const productId = await createProduct();
    await inventory.receiveOnHand({
      productId,
      quantity: 10,
      referenceType: 'RECEIVE',
      referenceId: randomUUID(),
      actor: SYSTEM_ACTOR,
    });
    await inventory.reserveForOrder({
      orderId: randomUUID(),
      lines: [{ productId, quantity: 8 }],
      actor: SYSTEM_ACTOR,
    });

    await expect(
      inventoryOps.adjustStock({
        productId,
        delta: -4,
        reason: 'cycle count',
        idempotencyKey: randomUUID(),
        principal: adminPrincipal,
      }),
    ).rejects.toMatchObject({
      code: 'INVENTORY_INVALID_ADJUSTMENT',
      message: InventoryHttpMessage.INVALID_ADJUSTMENT,
    });

    const adjusted = await inventoryOps.adjustStock({
      productId,
      delta: -2,
      reason: 'cycle count',
      idempotencyKey: randomUUID(),
      principal: adminPrincipal,
    });
    expect(adjusted).toMatchObject({ onHand: 8, reserved: 8, available: 0 });
  });

  it('rejects same idempotency key with different payload', async () => {
    const productId = await createProduct();
    const idempotencyKey = randomUUID();

    await inventoryOps.receiveStock({
      productId,
      quantity: 5,
      idempotencyKey,
      principal: adminPrincipal,
    });

    await expect(
      inventoryOps.receiveStock({
        productId,
        quantity: 6,
        idempotencyKey,
        principal: adminPrincipal,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('lets concurrent receives with the same idempotency key mutate once', async () => {
    const productId = await createProduct();
    const idempotencyKey = randomUUID();

    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        inventoryOps.receiveStock({
          productId,
          quantity: 25,
          idempotencyKey,
          principal: adminPrincipal,
        }),
      ),
    );

    expect(outcomes.every((row) => row.status === 'fulfilled')).toBe(true);
    expect(await inventory.getBalance(productId)).toMatchObject({
      onHand: 25,
      reserved: 0,
    });
    expect(
      await prisma.inventoryLedger.count({
        where: { productId, type: 'RECEIVE' },
      }),
    ).toBe(1);
  });

  it('rejects integer overflow receive safely', async () => {
    const productId = await createProduct();
    await inventory.receiveOnHand({
      productId,
      quantity: 2_147_483_640,
      referenceType: 'RECEIVE',
      referenceId: randomUUID(),
      actor: SYSTEM_ACTOR,
    });

    await expect(
      inventoryOps.receiveStock({
        productId,
        quantity: 10,
        idempotencyKey: randomUUID(),
        principal: adminPrincipal,
      }),
    ).rejects.toMatchObject({
      code: 'INVENTORY_INVALID_QUANTITY',
      message: InventoryHttpMessage.INVALID_QUANTITY,
    });
  });

  it('replays identical adjust commands without double mutation', async () => {
    const productId = await createProduct();
    await inventory.receiveOnHand({
      productId,
      quantity: 20,
      referenceType: 'RECEIVE',
      referenceId: randomUUID(),
      actor: SYSTEM_ACTOR,
    });
    const idempotencyKey = randomUUID();

    const first = await inventoryOps.adjustStock({
      productId,
      delta: -3,
      reason: 'cycle count',
      idempotencyKey,
      principal: adminPrincipal,
    });
    expect(first).toMatchObject({ onHand: 17, reserved: 0 });

    const replay = await inventoryOps.adjustStock({
      productId,
      delta: -3,
      reason: 'cycle count',
      idempotencyKey,
      principal: adminPrincipal,
    });
    expect(replay.onHand).toBe(17);
    expect(
      await prisma.inventoryLedger.count({
        where: { productId, type: 'ADJUST' },
      }),
    ).toBe(1);
  });

  it('records admin actor and reason on receive/adjust ledger rows', async () => {
    const productId = await createProduct();
    const receiveKey = randomUUID();
    const adjustKey = randomUUID();

    await inventoryOps.receiveStock({
      productId,
      quantity: 12,
      idempotencyKey: receiveKey,
      principal: adminPrincipal,
    });
    await inventoryOps.adjustStock({
      productId,
      delta: -2,
      reason: 'damaged carton',
      idempotencyKey: adjustKey,
      principal: adminPrincipal,
    });

    const rows = await prisma.inventoryLedger.findMany({
      where: { productId },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      type: 'RECEIVE',
      actorType: 'ADMIN',
      actorId: adminPrincipal.subjectId,
      correlationId: receiveKey,
      referenceId: receiveKey,
    });
    expect(rows[1]).toMatchObject({
      type: 'ADJUST',
      actorType: 'ADMIN',
      actorId: adminPrincipal.subjectId,
      reason: 'damaged carton',
      correlationId: adjustKey,
      referenceId: adjustKey,
    });
  });

  it('rejects zero-quantity receive at the domain layer', async () => {
    const productId = await createProduct();
    await expect(
      inventoryOps.receiveStock({
        productId,
        quantity: 0,
        idempotencyKey: randomUUID(),
        principal: adminPrincipal,
      }),
    ).rejects.toBeInstanceOf(InventoryInvalidQuantityError);
  });
});

import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  postgresIntegrationImports,
  unusedPricingServiceProvider,
} from '../support/postgres-testing-module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { CategoryRepository } from '../../../src/modules/categories/infrastructure/category.repository';
import { CategoryService } from '../../../src/modules/categories/application/category.service';
import {
  InventoryService,
  SYSTEM_ACTOR,
} from '../../../src/modules/inventory/application/inventory.service';
import { InventoryLedgerReferenceType } from '../../../src/modules/inventory/domain/inventory-ledger';
import {
  InventoryInsufficientStockError,
  InventoryInvalidAdjustmentError,
  InventoryReservationConflictError,
} from '../../../src/modules/inventory/domain/inventory-errors';
import { InventoryModule } from '../../../src/modules/inventory/inventory.module';
import { ProductService } from '../../../src/modules/products/application/product.service';
import { ProductRepository } from '../../../src/modules/products/infrastructure/product.repository';
import { TransactionRunner } from '../../../src/infrastructure/database/transaction';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

async function truncateInventoryTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "InventoryLedger", "InventoryReservation", "Inventory", "Product", "Category" RESTART IDENTITY CASCADE',
  );
}

describe('Inventory persistence (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let categories: CategoryRepository;
  let products: ProductRepository;
  let productService: ProductService;
  let inventory: InventoryService;
  let transactions: TransactionRunner;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [...postgresIntegrationImports([InventoryModule])],
      providers: [
        CategoryRepository,
        CategoryService,
        ProductRepository,
        ProductService,
        unusedPricingServiceProvider(),
      ],
    }).compile();

    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    categories = moduleRef.get(CategoryRepository);
    products = moduleRef.get(ProductRepository);
    productService = moduleRef.get(ProductService);
    inventory = moduleRef.get(InventoryService);
    transactions = moduleRef.get(TransactionRunner);
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

  async function stockProduct(onHand: number): Promise<string> {
    const productId = await createProduct();
    if (onHand > 0) {
      await inventory.receiveOnHand({
        productId,
        quantity: onHand,
        referenceType: InventoryLedgerReferenceType.RECEIVE,
        referenceId: randomUUID(),
        actor: SYSTEM_ACTOR,
      });
    }
    return productId;
  }

  describe('constraints', () => {
    it('rejects negative onHand, reserved, and reserved > onHand', async () => {
      const productId = await createProduct();

      await expect(
        prisma.inventory.update({
          where: { productId },
          data: { onHand: -1 },
        }),
      ).rejects.toThrow();

      await expect(
        prisma.$executeRaw`
          UPDATE "Inventory" SET "reserved" = 1, "onHand" = 0
          WHERE "productId" = ${productId}::uuid
        `,
      ).rejects.toThrow();
    });

    it('rejects non-positive reservation quantity and invalid ledger after-balances', async () => {
      const productId = await createProduct();

      await expect(
        prisma.inventoryReservation.create({
          data: {
            orderId: randomUUID(),
            productId,
            quantity: 0,
            status: 'ACTIVE',
          },
        }),
      ).rejects.toThrow();

      await expect(
        prisma.inventoryLedger.create({
          data: {
            productId,
            type: 'RESERVE',
            quantity: 1,
            onHandDelta: 0,
            reservedDelta: 1,
            onHandAfter: 0,
            reservedAfter: 1,
            referenceType: 'ORDER',
            referenceId: randomUUID(),
            actorType: 'SYSTEM',
          },
        }),
      ).rejects.toThrow();
    });

    it('RESTRICT prevents deleting a Product that still has Inventory', async () => {
      const productId = await createProduct();
      await expect(
        prisma.product.delete({ where: { id: productId } }),
      ).rejects.toThrow();
    });
  });

  describe('ensureForProduct and backfill', () => {
    it('is idempotent under 20 concurrent calls', async () => {
      const category = await categories.create({ name: 'Eggs' });
      const product = await products.create({
        name: 'Bypass',
        price: 1000,
        categoryId: category.id,
      });

      await Promise.all(
        Array.from({ length: 20 }, () =>
          inventory.ensureForProduct(product.id),
        ),
      );

      const rows = await prisma.inventory.findMany({
        where: { productId: product.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ onHand: 0, reserved: 0 });
    });

    it('backfill SQL fills missing 0/0 rows without inventing stock', async () => {
      const category = await categories.create({ name: 'Eggs' });
      const product = await products.create({
        name: 'Legacy',
        price: 1000,
        categoryId: category.id,
      });
      expect(await inventory.getBalance(product.id)).toBeNull();

      await prisma.$executeRaw`
        INSERT INTO "Inventory" ("productId", "onHand", "reserved", "createdAt", "updatedAt")
        SELECT "id", 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM "Product"
        ON CONFLICT ("productId") DO NOTHING
      `;

      expect(await inventory.getBalance(product.id)).toMatchObject({
        onHand: 0,
        reserved: 0,
        available: 0,
      });
    });
  });

  describe('reserve concurrency', () => {
    it('lets exactly 10 of 20 concurrent qty-1 reserves succeed on 10 onHand', async () => {
      const productId = await stockProduct(10);
      const outcomes = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          inventory.reserveForOrder({
            orderId: randomUUID(),
            lines: [{ productId, quantity: 1 }],
            actor: SYSTEM_ACTOR,
          }),
        ),
      );

      const succeeded = outcomes.filter((row) => row.status === 'fulfilled');
      const failed = outcomes.filter((row) => row.status === 'rejected');
      expect(succeeded).toHaveLength(10);
      expect(failed).toHaveLength(10);
      for (const row of failed) {
        expect(row.status).toBe('rejected');
        if (row.status === 'rejected') {
          expect(row.reason).toBeInstanceOf(InventoryInsufficientStockError);
        }
      }

      const finalBalance = await inventory.getBalance(productId);
      expect(finalBalance).toMatchObject({
        onHand: 10,
        reserved: 10,
        available: 0,
      });
    });

    it('keeps successful variable-quantity reserves within onHand', async () => {
      const productId = await stockProduct(10);
      const quantities = Array.from(
        { length: 20 },
        (_, index) => (index % 3) + 1,
      );
      const outcomes = await Promise.allSettled(
        quantities.map((quantity) =>
          inventory.reserveForOrder({
            orderId: randomUUID(),
            lines: [{ productId, quantity }],
            actor: SYSTEM_ACTOR,
          }),
        ),
      );

      const succeeded = outcomes.filter(
        (row) => row.status === 'fulfilled',
      ) as PromiseFulfilledResult<{
        lines: Array<{ quantity: number }>;
      }>[];
      const reservedSum = succeeded.reduce(
        (sum, row) => sum + (row.value.lines[0]?.quantity ?? 0),
        0,
      );
      expect(reservedSum).toBeLessThanOrEqual(10);

      const finalBalance = await inventory.getBalance(productId);
      expect(finalBalance).not.toBeNull();
      expect(finalBalance!.available).toBeGreaterThanOrEqual(0);
      expect(finalBalance!.reserved).toBeLessThanOrEqual(finalBalance!.onHand);
      expect(finalBalance!.reserved).toBe(reservedSum);
    });
  });

  describe('release, ship, adjust', () => {
    it('cannot underflow reserved across concurrent releases', async () => {
      const productId = await stockProduct(5);
      const reserved = await inventory.reserveForOrder({
        orderId: randomUUID(),
        lines: [{ productId, quantity: 5 }],
        actor: SYSTEM_ACTOR,
      });

      const outcomes = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          inventory.releaseReservation({
            orderId: reserved.orderId,
            productId,
            actor: SYSTEM_ACTOR,
          }),
        ),
      );

      expect(outcomes.filter((row) => row.status === 'fulfilled')).toHaveLength(
        8,
      );
      expect(await inventory.getBalance(productId)).toMatchObject({
        onHand: 5,
        reserved: 0,
        available: 5,
      });
      expect(
        await prisma.inventoryLedger.count({
          where: { productId, type: 'RELEASE' },
        }),
      ).toBe(1);
    });

    it('ships an ACTIVE reservation once under concurrent calls', async () => {
      const productId = await stockProduct(8);
      const reserved = await inventory.reserveForOrder({
        orderId: randomUUID(),
        lines: [{ productId, quantity: 3 }],
        actor: SYSTEM_ACTOR,
      });

      await Promise.all(
        Array.from({ length: 6 }, () =>
          inventory.shipReservation({
            orderId: reserved.orderId,
            productId,
            actor: SYSTEM_ACTOR,
          }),
        ),
      );

      expect(await inventory.getBalance(productId)).toMatchObject({
        onHand: 5,
        reserved: 0,
        available: 5,
      });
      expect(
        await prisma.inventoryLedger.count({
          where: { productId, type: 'SHIP' },
        }),
      ).toBe(1);
    });

    it('never lets concurrent adjust-down and reserve violate reserved <= onHand', async () => {
      const productId = await stockProduct(10);
      await Promise.allSettled([
        ...Array.from({ length: 10 }, () =>
          inventory.reserveForOrder({
            orderId: randomUUID(),
            lines: [{ productId, quantity: 1 }],
            actor: SYSTEM_ACTOR,
          }),
        ),
        ...Array.from({ length: 10 }, () =>
          inventory.adjustOnHand({
            productId,
            delta: -1,
            referenceType: InventoryLedgerReferenceType.ADJUSTMENT,
            referenceId: randomUUID(),
            reason: 'cycle count',
            actor: SYSTEM_ACTOR,
          }),
        ),
      ]);

      const finalBalance = await inventory.getBalance(productId);
      expect(finalBalance).not.toBeNull();
      expect(finalBalance!.onHand).toBeGreaterThanOrEqual(0);
      expect(finalBalance!.reserved).toBeGreaterThanOrEqual(0);
      expect(finalBalance!.reserved).toBeLessThanOrEqual(finalBalance!.onHand);
      expect(finalBalance!.available).toBeGreaterThanOrEqual(0);
    });
  });

  describe('reservation uniqueness and ledger atomicity', () => {
    it('rejects a second distinct reservation for the same order and product', async () => {
      const productId = await stockProduct(5);
      const orderId = randomUUID();
      await inventory.reserveForOrder({
        orderId,
        lines: [{ productId, quantity: 1 }],
        actor: SYSTEM_ACTOR,
      });

      await expect(
        inventory.reserveForOrder({
          orderId,
          lines: [{ productId, quantity: 2 }],
          actor: SYSTEM_ACTOR,
        }),
      ).rejects.toBeInstanceOf(InventoryReservationConflictError);
    });

    it('treats concurrent identical reserves as one increment', async () => {
      const productId = await stockProduct(5);
      const orderId = randomUUID();
      const outcomes = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          inventory.reserveForOrder({
            orderId,
            lines: [{ productId, quantity: 2 }],
            actor: SYSTEM_ACTOR,
          }),
        ),
      );

      expect(outcomes.filter((row) => row.status === 'fulfilled')).toHaveLength(
        8,
      );
      expect(await inventory.getBalance(productId)).toMatchObject({
        onHand: 5,
        reserved: 2,
        available: 3,
      });
      expect(
        await prisma.inventoryLedger.count({
          where: { productId, type: 'RESERVE' },
        }),
      ).toBe(1);
    });

    it('keeps a joined transaction usable after a duplicate reserve', async () => {
      const productId = await stockProduct(4);
      const orderId = randomUUID();

      await transactions.run(async (tx) => {
        await inventory.reserveForOrder(
          {
            orderId,
            lines: [{ productId, quantity: 1 }],
            actor: SYSTEM_ACTOR,
          },
          tx,
        );
        await inventory.reserveForOrder(
          {
            orderId,
            lines: [{ productId, quantity: 1 }],
            actor: SYSTEM_ACTOR,
          },
          tx,
        );
        expect(await inventory.getBalance(productId, tx)).toMatchObject({
          reserved: 1,
        });
      });

      expect(await inventory.getBalance(productId)).toMatchObject({
        onHand: 4,
        reserved: 1,
        available: 3,
      });
    });

    it('rejects write-off that would drop onHand below reserved', async () => {
      const productId = await stockProduct(5);
      await inventory.reserveForOrder({
        orderId: randomUUID(),
        lines: [{ productId, quantity: 4 }],
        actor: SYSTEM_ACTOR,
      });

      await expect(
        inventory.writeOffOnHand({
          productId,
          quantity: 2,
          referenceType: InventoryLedgerReferenceType.ADJUSTMENT,
          referenceId: randomUUID(),
          reason: 'damaged',
          actor: SYSTEM_ACTOR,
        }),
      ).rejects.toBeInstanceOf(InventoryInvalidAdjustmentError);

      expect(await inventory.getBalance(productId)).toMatchObject({
        onHand: 5,
        reserved: 4,
      });
    });

    it('rolls back the balance mutation when ledger insert fails', async () => {
      const productId = await stockProduct(4);

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            UPDATE "Inventory"
            SET "reserved" = "reserved" + 1,
                "updatedAt" = now()
            WHERE "productId" = ${productId}::uuid
              AND "onHand" - "reserved" >= 1
          `;
          await tx.inventoryLedger.create({
            data: {
              productId,
              type: 'RESERVE',
              quantity: 1,
              onHandDelta: 0,
              reservedDelta: 1,
              onHandAfter: 4,
              reservedAfter: -1,
              referenceType: 'ORDER',
              referenceId: randomUUID(),
              actorType: 'SYSTEM',
            },
          });
        }),
      ).rejects.toThrow();

      expect(await inventory.getBalance(productId)).toMatchObject({
        onHand: 4,
        reserved: 0,
      });
      expect(
        await prisma.inventoryLedger.count({
          where: { productId, type: 'RESERVE' },
        }),
      ).toBe(0);
    });

    it('does not write a ledger row when the balance mutation fails', async () => {
      const productId = await stockProduct(1);
      const before = await prisma.inventoryLedger.count({
        where: { productId },
      });

      await expect(
        inventory.reserveForOrder({
          orderId: randomUUID(),
          lines: [{ productId, quantity: 5 }],
          actor: SYSTEM_ACTOR,
        }),
      ).rejects.toBeInstanceOf(InventoryInsufficientStockError);

      expect(await prisma.inventoryLedger.count({ where: { productId } })).toBe(
        before,
      );
      expect(await inventory.getBalance(productId)).toMatchObject({
        onHand: 1,
        reserved: 0,
      });
    });
  });
});

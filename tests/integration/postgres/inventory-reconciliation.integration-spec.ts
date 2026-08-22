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
import { InventoryReconciliationService } from '../../../src/modules/inventory/application/inventory-reconciliation.service';
import {
  InventoryService,
  SYSTEM_ACTOR,
} from '../../../src/modules/inventory/application/inventory.service';
import {
  InventoryReconciliationIssueCode,
  InventoryReconciliationStatus,
} from '../../../src/modules/inventory/domain/inventory-reconciliation';
import { InventoryNotFoundError } from '../../../src/modules/inventory/domain/inventory-errors';
import {
  InventoryLedgerActorType,
  InventoryLedgerReferenceType,
} from '../../../src/modules/inventory/domain/inventory-ledger';
import { InventoryModule } from '../../../src/modules/inventory/inventory.module';
import { InventoryBalanceRepository } from '../../../src/modules/inventory/infrastructure/inventory-balance.repository';
import { ProductService } from '../../../src/modules/products/application/product.service';
import { ProductRepository } from '../../../src/modules/products/infrastructure/product.repository';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

async function truncateInventoryTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "InventoryLedger", "InventoryReservation", "Inventory", "Product", "Category" RESTART IDENTITY CASCADE',
  );
}

describe('Inventory reconciliation (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let categories: CategoryRepository;
  let productService: ProductService;
  let inventory: InventoryService;
  let reconciliation: InventoryReconciliationService;
  let balances: InventoryBalanceRepository;

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
    inventory = moduleRef.get(InventoryService);
    reconciliation = moduleRef.get(InventoryReconciliationService);
    balances = moduleRef.get(InventoryBalanceRepository);
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

  const adminActor = {
    type: InventoryLedgerActorType.ADMIN,
    id: randomUUID(),
  };

  async function countRows(productId: string): Promise<{
    ledger: number;
    reservations: number;
  }> {
    const [ledgerCount, reservationCount] = await Promise.all([
      prisma.inventoryLedger.count({ where: { productId } }),
      prisma.inventoryReservation.count({ where: { productId } }),
    ]);
    return { ledger: ledgerCount, reservations: reservationCount };
  }

  it('reports fresh product inventory 0/0 as consistent', async () => {
    const productId = await createProduct();
    const result = await reconciliation.reconcileProduct(productId);
    expect(result.status).toBe(InventoryReconciliationStatus.CONSISTENT);
    expect(result.current).toEqual({
      onHand: 0,
      reserved: 0,
      available: 0,
    });
  });

  it('stays consistent after receive', async () => {
    const productId = await stockProduct(25);
    const result = await reconciliation.reconcileProduct(productId);
    expect(result.status).toBe(InventoryReconciliationStatus.CONSISTENT);
    expect(result.current.onHand).toBe(25);
  });

  it('stays consistent after adjust', async () => {
    const productId = await stockProduct(20);
    await inventory.adjustOnHand({
      productId,
      delta: -4,
      reason: 'cycle count',
      referenceType: InventoryLedgerReferenceType.ADJUSTMENT,
      referenceId: randomUUID(),
      actor: adminActor,
    });
    const result = await reconciliation.reconcileProduct(productId);
    expect(result.status).toBe(InventoryReconciliationStatus.CONSISTENT);
    expect(result.current.onHand).toBe(16);
  });

  it('stays consistent after reserve', async () => {
    const productId = await stockProduct(20);
    const orderId = randomUUID();
    await inventory.reserveForOrder({
      orderId,
      lines: [{ productId, quantity: 5 }],
      actor: SYSTEM_ACTOR,
    });
    const result = await reconciliation.reconcileProduct(productId);
    expect(result.status).toBe(InventoryReconciliationStatus.CONSISTENT);
    expect(result.current.reserved).toBe(5);
  });

  it('stays consistent after release', async () => {
    const productId = await stockProduct(20);
    const orderId = randomUUID();
    await inventory.reserveForOrder({
      orderId,
      lines: [{ productId, quantity: 5 }],
      actor: SYSTEM_ACTOR,
    });
    await inventory.releaseForOrder({ orderId, actor: SYSTEM_ACTOR });
    const result = await reconciliation.reconcileProduct(productId);
    expect(result.status).toBe(InventoryReconciliationStatus.CONSISTENT);
    expect(result.current.reserved).toBe(0);
  });

  it('stays consistent after ship', async () => {
    const productId = await stockProduct(20);
    const orderId = randomUUID();
    await inventory.reserveForOrder({
      orderId,
      lines: [{ productId, quantity: 5 }],
      actor: SYSTEM_ACTOR,
    });
    await inventory.shipForOrder({ orderId, actor: SYSTEM_ACTOR });
    const result = await reconciliation.reconcileProduct(productId);
    expect(result.status).toBe(InventoryReconciliationStatus.CONSISTENT);
    expect(result.current).toEqual({
      onHand: 15,
      reserved: 0,
      available: 15,
    });
  });

  it('stays consistent through receive + reserve + ship sequence', async () => {
    const productId = await stockProduct(30);
    const orderId = randomUUID();
    await inventory.reserveForOrder({
      orderId,
      lines: [{ productId, quantity: 8 }],
      actor: SYSTEM_ACTOR,
    });
    await inventory.shipForOrder({ orderId, actor: SYSTEM_ACTOR });
    const result = await reconciliation.reconcileProduct(productId);
    expect(result.status).toBe(InventoryReconciliationStatus.CONSISTENT);
  });

  it('detects manual current-balance corruption', async () => {
    const productId = await stockProduct(100);
    const orderId = randomUUID();
    await inventory.reserveForOrder({
      orderId,
      lines: [{ productId, quantity: 5 }],
      actor: SYSTEM_ACTOR,
    });
    await prisma.$executeRaw`
      UPDATE "Inventory"
      SET "reserved" = 8
      WHERE "productId" = ${productId}::uuid
    `;
    const result = await reconciliation.reconcileProduct(productId);
    expect(result.status).toBe(InventoryReconciliationStatus.INCONSISTENT);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: InventoryReconciliationIssueCode.RESERVED_MISMATCH,
        }),
      ]),
    );
  });

  it('detects missing RESERVE ledger lifecycle event', async () => {
    const productId = await stockProduct(20);
    const orderId = randomUUID();
    await inventory.reserveForOrder({
      orderId,
      lines: [{ productId, quantity: 4 }],
      actor: SYSTEM_ACTOR,
    });
    await prisma.$executeRaw`
      DELETE FROM "InventoryLedger"
      WHERE "productId" = ${productId}::uuid
        AND "type" = 'RESERVE'::"InventoryLedgerType"
    `;
    const result = await reconciliation.reconcileProduct(productId);
    expect(result.status).toBe(InventoryReconciliationStatus.INCONSISTENT);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: InventoryReconciliationIssueCode.RESERVATION_LEDGER_MISMATCH,
        }),
        expect.objectContaining({
          code: InventoryReconciliationIssueCode.LEDGER_BALANCE_MISMATCH,
        }),
      ]),
    );
  });

  it('detects reservation aggregate mismatch', async () => {
    const productId = await stockProduct(50);
    const orderA = randomUUID();
    const orderB = randomUUID();
    await inventory.reserveForOrder({
      orderId: orderA,
      lines: [{ productId, quantity: 3 }],
      actor: SYSTEM_ACTOR,
    });
    await inventory.reserveForOrder({
      orderId: orderB,
      lines: [{ productId, quantity: 2 }],
      actor: SYSTEM_ACTOR,
    });
    await prisma.$executeRaw`
      UPDATE "Inventory"
      SET "reserved" = 10
      WHERE "productId" = ${productId}::uuid
    `;
    const result = await reconciliation.reconcileProduct(productId);
    const mismatch = result.issues.find(
      (issue) =>
        issue.code === InventoryReconciliationIssueCode.RESERVED_MISMATCH,
    );
    expect(mismatch).toBeDefined();
    expect(mismatch!.details).toMatchObject({
      currentReserved: 10,
      activeReservationTotal: 5,
    });
  });

  it('never mutates inventory rows during reconciliation', async () => {
    const productId = await stockProduct(40);
    const orderId = randomUUID();
    await inventory.reserveForOrder({
      orderId,
      lines: [{ productId, quantity: 6 }],
      actor: SYSTEM_ACTOR,
    });
    const before = await prisma.inventory.findUnique({ where: { productId } });
    const countsBefore = await countRows(productId);
    await reconciliation.reconcileProduct(productId);
    const after = await prisma.inventory.findUnique({ where: { productId } });
    const countsAfter = await countRows(productId);
    expect(after).toEqual(before);
    expect(countsAfter).toEqual(countsBefore);
  });

  it('handles a large ledger history without unbounded failure', async () => {
    const productId = await createProduct();
    for (let index = 0; index < 120; index += 1) {
      await inventory.receiveOnHand({
        productId,
        quantity: 1,
        referenceType: InventoryLedgerReferenceType.RECEIVE,
        referenceId: randomUUID(),
        actor: SYSTEM_ACTOR,
      });
    }
    const result = await reconciliation.reconcileProduct(productId);
    expect(result.status).toBe(InventoryReconciliationStatus.CONSISTENT);
    expect(result.current.onHand).toBe(120);
  });

  it('uses reconcileProduct for a coherent snapshot during concurrent mutation', async () => {
    const productId = await stockProduct(100);

    const originalFind = balances.findByProductId.bind(balances);
    let paused = false;
    jest
      .spyOn(balances, 'findByProductId')
      .mockImplementation(async (id, ctx) => {
        const result = await originalFind(id, ctx);
        if (!paused) {
          paused = true;
          await inventory.receiveOnHand({
            productId,
            quantity: 50,
            referenceType: InventoryLedgerReferenceType.RECEIVE,
            referenceId: randomUUID(),
            actor: SYSTEM_ACTOR,
          });
        }
        return result;
      });

    const snapshotResult = await reconciliation.reconcileProduct(productId);

    expect(snapshotResult.status).toBe(
      InventoryReconciliationStatus.CONSISTENT,
    );
    expect(snapshotResult.current.onHand).toBe(100);

    const live = await inventory.getBalance(productId);
    expect(live!.onHand).toBe(150);

    const postMutation = await reconciliation.reconcileProduct(productId);
    expect(postMutation.status).toBe(InventoryReconciliationStatus.CONSISTENT);
    expect(postMutation.current.onHand).toBe(150);

    jest.restoreAllMocks();
  });

  it('keeps reconcileProduct internally coherent while receive races', async () => {
    const productId = await stockProduct(50);
    const [snapshot] = await Promise.all([
      reconciliation.reconcileProduct(productId),
      inventory.receiveOnHand({
        productId,
        quantity: 10,
        referenceType: InventoryLedgerReferenceType.RECEIVE,
        referenceId: randomUUID(),
        actor: SYSTEM_ACTOR,
      }),
    ]);
    expect(snapshot.status).toBe(InventoryReconciliationStatus.CONSISTENT);
    expect([50, 60]).toContain(snapshot.current.onHand);
  });

  it('throws when inventory row is missing', async () => {
    const missingProductId = randomUUID();
    await expect(
      reconciliation.reconcileProduct(missingProductId),
    ).rejects.toBeInstanceOf(InventoryNotFoundError);
  });
});

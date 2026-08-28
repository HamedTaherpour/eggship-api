import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  postgresIntegrationImports,
  unusedPricingServiceProvider,
} from '../support/postgres-testing-module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { TransactionRunner } from '../../../src/infrastructure/database/transaction';
import { CategoryRepository } from '../../../src/modules/categories/infrastructure/category.repository';
import { CategoryService } from '../../../src/modules/categories/application/category.service';
import {
  InventoryService,
  SYSTEM_ACTOR,
} from '../../../src/modules/inventory/application/inventory.service';
import {
  InventoryInsufficientStockError,
  InventoryNotFoundError,
  InventoryReservationConflictError,
  InventoryReservationNotFoundError,
} from '../../../src/modules/inventory/domain/inventory-errors';
import { InventoryHttpMessage } from '../../../src/modules/inventory/domain/inventory-http-messages';
import { InventoryLedgerReferenceType } from '../../../src/modules/inventory/domain/inventory-ledger';
import { InventoryModule } from '../../../src/modules/inventory/inventory.module';
import { ProductService } from '../../../src/modules/products/application/product.service';
import { ProductRepository } from '../../../src/modules/products/infrastructure/product.repository';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';
import { ConcurrencyGate } from '../support/concurrency-gate';

async function truncateInventoryTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "InventoryLedger", "InventoryReservation", "Inventory", "Product", "Category" RESTART IDENTITY CASCADE',
  );
}

describe('Inventory reservation and release (integration)', () => {
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

  async function assertNoResidue(productIds: readonly string[]): Promise<void> {
    for (const productId of productIds) {
      expect(await inventory.getBalance(productId)).toMatchObject({
        reserved: 0,
      });
      expect(
        await prisma.inventoryReservation.count({ where: { productId } }),
      ).toBe(0);
      expect(
        await prisma.inventoryLedger.count({
          where: { productId, type: 'RESERVE' },
        }),
      ).toBe(0);
    }
  }

  it('reserves a single SKU and writes one ACTIVE row plus one RESERVE ledger', async () => {
    const productId = await stockProduct(10);
    const orderId = randomUUID();

    const result = await inventory.reserveForOrder({
      orderId,
      lines: [{ productId, quantity: 3 }],
      actor: SYSTEM_ACTOR,
    });

    expect(result).toEqual({
      orderId,
      lines: [{ productId, quantity: 3, status: 'ACTIVE' }],
    });
    expect(await inventory.getBalance(productId)).toMatchObject({
      onHand: 10,
      reserved: 3,
      available: 7,
    });
    expect(
      await prisma.inventoryReservation.findMany({ where: { orderId } }),
    ).toHaveLength(1);
    expect(
      await prisma.inventoryLedger.count({
        where: { productId, type: 'RESERVE', referenceId: orderId },
      }),
    ).toBe(1);
  });

  it('reserves multiple SKUs atomically', async () => {
    const first = await stockProduct(10);
    const second = await stockProduct(8);
    const orderId = randomUUID();

    const result = await inventory.reserveForOrder({
      orderId,
      lines: [
        { productId: first, quantity: 3 },
        { productId: second, quantity: 5 },
      ],
      actor: SYSTEM_ACTOR,
    });

    expect(result.lines).toHaveLength(2);
    expect(await inventory.getBalance(first)).toMatchObject({ reserved: 3 });
    expect(await inventory.getBalance(second)).toMatchObject({ reserved: 5 });
    expect(
      await prisma.inventoryReservation.count({ where: { orderId } }),
    ).toBe(2);
  });

  it('writes nothing when one multi-SKU line is short', async () => {
    const ample = await stockProduct(10);
    const short = await stockProduct(4);
    const extra = await stockProduct(20);
    const orderId = randomUUID();

    await expect(
      inventory.reserveForOrder({
        orderId,
        lines: [
          { productId: ample, quantity: 3 },
          { productId: short, quantity: 5 },
          { productId: extra, quantity: 2 },
        ],
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toMatchObject({
      code: 'INVENTORY_INSUFFICIENT_STOCK',
      message: InventoryHttpMessage.INSUFFICIENT_STOCK,
      details: { lines: [{ productId: short, requested: 5 }] },
    });

    await assertNoResidue([ample, short, extra]);
  });

  it('fails the whole reservation when any Inventory row is missing', async () => {
    const category = await categories.create({ name: `Cat ${randomUUID()}` });
    const existing = await stockProduct(5);
    const orphan = await products.create({
      name: `Bypass ${randomUUID()}`,
      price: 1000,
      categoryId: category.id,
    });

    await expect(
      inventory.reserveForOrder({
        orderId: randomUUID(),
        lines: [
          { productId: existing, quantity: 1 },
          { productId: orphan.id, quantity: 1 },
        ],
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toBeInstanceOf(InventoryNotFoundError);

    await assertNoResidue([existing]);
    expect(await inventory.getBalance(orphan.id)).toBeNull();
  });

  it('lets exactly 10 of 20 distinct buyers reserve qty 1 from 10 onHand', async () => {
    const productId = await stockProduct(10);
    const gate = new ConcurrencyGate(20);
    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        (async (): Promise<
          Awaited<ReturnType<InventoryService['reserveForOrder']>>
        > => {
          await gate.arriveAndWait();
          return inventory.reserveForOrder({
            orderId: randomUUID(),
            lines: [{ productId, quantity: 1 }],
            actor: SYSTEM_ACTOR,
          });
        })(),
      ),
    );

    expect(outcomes.filter((row) => row.status === 'fulfilled')).toHaveLength(
      10,
    );
    expect(outcomes.filter((row) => row.status === 'rejected')).toHaveLength(
      10,
    );
    for (const row of outcomes) {
      if (row.status === 'rejected') {
        expect(row.reason).toBeInstanceOf(InventoryInsufficientStockError);
      }
    }
    expect(await inventory.getBalance(productId)).toMatchObject({
      onHand: 10,
      reserved: 10,
      available: 0,
    });
    expect(
      await prisma.inventoryReservation.count({
        where: { productId, status: 'ACTIVE' },
      }),
    ).toBe(10);
    expect(
      await prisma.inventoryLedger.count({
        where: { productId, type: 'RESERVE' },
      }),
    ).toBe(10);
  });

  it('keeps concurrent variable-quantity reserves within onHand', async () => {
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
    const reservedSum = outcomes.reduce((sum, row) => {
      if (row.status !== 'fulfilled') {
        return sum;
      }
      return sum + (row.value.lines[0]?.quantity ?? 0);
    }, 0);

    const finalBalance = await inventory.getBalance(productId);
    expect(reservedSum).toBeLessThanOrEqual(10);
    expect(finalBalance).toMatchObject({ reserved: reservedSum });
    expect(finalBalance!.reserved).toBeLessThanOrEqual(finalBalance!.onHand);
  });

  it('treats 20 concurrent identical same-order reserves as one logical reservation', async () => {
    const productId = await stockProduct(5);
    const orderId = randomUUID();
    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        inventory.reserveForOrder({
          orderId,
          lines: [{ productId, quantity: 2 }],
          actor: SYSTEM_ACTOR,
        }),
      ),
    );

    expect(outcomes.every((row) => row.status === 'fulfilled')).toBe(true);
    expect(await inventory.getBalance(productId)).toMatchObject({
      onHand: 5,
      reserved: 2,
    });
    expect(
      await prisma.inventoryReservation.count({ where: { orderId } }),
    ).toBe(1);
    expect(
      await prisma.inventoryLedger.count({
        where: { productId, type: 'RESERVE', referenceId: orderId },
      }),
    ).toBe(1);
  });

  it('lets only one mismatched same-order payload establish the reservation', async () => {
    const productId = await stockProduct(10);
    const orderId = randomUUID();
    const outcomes = await Promise.allSettled([
      inventory.reserveForOrder({
        orderId,
        lines: [{ productId, quantity: 2 }],
        actor: SYSTEM_ACTOR,
      }),
      inventory.reserveForOrder({
        orderId,
        lines: [{ productId, quantity: 3 }],
        actor: SYSTEM_ACTOR,
      }),
    ]);

    const succeeded = outcomes.filter((row) => row.status === 'fulfilled');
    const failed = outcomes.filter((row) => row.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    if (failed[0]?.status === 'rejected') {
      expect(failed[0].reason).toBeInstanceOf(
        InventoryReservationConflictError,
      );
    }

    const winnerQuantity =
      succeeded[0]?.status === 'fulfilled'
        ? succeeded[0].value.lines[0]?.quantity
        : undefined;
    expect([2, 3]).toContain(winnerQuantity);
    expect(await inventory.getBalance(productId)).toMatchObject({
      reserved: winnerQuantity,
    });
    expect(
      await prisma.inventoryLedger.count({
        where: { productId, type: 'RESERVE', referenceId: orderId },
      }),
    ).toBe(1);
  });

  it('does not deadlock when two orders reserve the same SKUs in reverse input order', async () => {
    const first = await stockProduct(5);
    const second = await stockProduct(5);
    const gate = new ConcurrencyGate(2);

    const [orderA, orderB] = await Promise.all([
      (async (): Promise<
        Awaited<ReturnType<InventoryService['reserveForOrder']>>
      > => {
        await gate.arriveAndWait();
        return inventory.reserveForOrder({
          orderId: randomUUID(),
          lines: [
            { productId: first, quantity: 1 },
            { productId: second, quantity: 1 },
          ],
          actor: SYSTEM_ACTOR,
        });
      })(),
      (async (): Promise<
        Awaited<ReturnType<InventoryService['reserveForOrder']>>
      > => {
        await gate.arriveAndWait();
        return inventory.reserveForOrder({
          orderId: randomUUID(),
          lines: [
            { productId: second, quantity: 1 },
            { productId: first, quantity: 1 },
          ],
          actor: SYSTEM_ACTOR,
        });
      })(),
    ]);

    expect(orderA.lines).toHaveLength(2);
    expect(orderB.lines).toHaveLength(2);
    expect(await inventory.getBalance(first)).toMatchObject({ reserved: 2 });
    expect(await inventory.getBalance(second)).toMatchObject({ reserved: 2 });
  });

  it('releases all ACTIVE lines and is idempotent on replay', async () => {
    const first = await stockProduct(6);
    const second = await stockProduct(4);
    const orderId = randomUUID();
    await inventory.reserveForOrder({
      orderId,
      lines: [
        { productId: first, quantity: 2 },
        { productId: second, quantity: 1 },
      ],
      actor: SYSTEM_ACTOR,
    });

    const released = await inventory.releaseForOrder({
      orderId,
      actor: SYSTEM_ACTOR,
    });
    expect(released.lines.every((line) => line.status === 'RELEASED')).toBe(
      true,
    );
    expect(await inventory.getBalance(first)).toMatchObject({
      onHand: 6,
      reserved: 0,
    });
    expect(await inventory.getBalance(second)).toMatchObject({
      onHand: 4,
      reserved: 0,
    });

    const replay = await inventory.releaseForOrder({
      orderId,
      actor: SYSTEM_ACTOR,
    });
    expect(replay.lines.every((line) => line.status === 'RELEASED')).toBe(true);
    expect(
      await prisma.inventoryLedger.count({
        where: { referenceId: orderId, type: 'RELEASE' },
      }),
    ).toBe(2);
  });

  it('rejects release after SHIP and does not undo shipment', async () => {
    const productId = await stockProduct(8);
    const orderId = randomUUID();
    await inventory.reserveForOrder({
      orderId,
      lines: [{ productId, quantity: 3 }],
      actor: SYSTEM_ACTOR,
    });
    await inventory.shipReservation({
      orderId,
      productId,
      actor: SYSTEM_ACTOR,
    });

    await expect(
      inventory.releaseForOrder({ orderId, actor: SYSTEM_ACTOR }),
    ).rejects.toBeInstanceOf(InventoryReservationConflictError);

    expect(await inventory.getBalance(productId)).toMatchObject({
      onHand: 5,
      reserved: 0,
    });
  });

  it('conflicts mixed reservation status instead of healing a remainder', async () => {
    const first = await stockProduct(5);
    const second = await stockProduct(5);
    const orderId = randomUUID();
    await prisma.inventoryReservation.createMany({
      data: [
        {
          orderId,
          productId: first,
          quantity: 1,
          status: 'ACTIVE',
        },
        {
          orderId,
          productId: second,
          quantity: 1,
          status: 'RELEASED',
        },
      ],
    });

    await expect(
      inventory.releaseForOrder({ orderId, actor: SYSTEM_ACTOR }),
    ).rejects.toBeInstanceOf(InventoryReservationConflictError);
    expect(await inventory.getBalance(first)).toMatchObject({ reserved: 0 });
    expect(await inventory.getBalance(second)).toMatchObject({ reserved: 0 });
  });

  it('lets only one disjoint-SKU payload win for the same order', async () => {
    const first = await stockProduct(5);
    const second = await stockProduct(5);
    const orderId = randomUUID();

    const outcomes = await Promise.allSettled([
      inventory.reserveForOrder({
        orderId,
        lines: [{ productId: first, quantity: 1 }],
        actor: SYSTEM_ACTOR,
      }),
      inventory.reserveForOrder({
        orderId,
        lines: [{ productId: second, quantity: 1 }],
        actor: SYSTEM_ACTOR,
      }),
    ]);

    const succeeded = outcomes.filter((row) => row.status === 'fulfilled');
    const failed = outcomes.filter((row) => row.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    if (failed[0]?.status === 'rejected') {
      expect(failed[0].reason).toBeInstanceOf(
        InventoryReservationConflictError,
      );
    }

    const winner =
      succeeded[0]?.status === 'fulfilled' ? succeeded[0].value : undefined;
    expect(winner?.lines).toHaveLength(1);
    const winnerProductId = winner?.lines[0]?.productId;
    const otherProductId = winnerProductId === first ? second : first;

    expect(
      await prisma.inventoryReservation.count({ where: { orderId } }),
    ).toBe(1);
    expect(await inventory.getBalance(winnerProductId!)).toMatchObject({
      reserved: 1,
    });
    expect(await inventory.getBalance(otherProductId)).toMatchObject({
      reserved: 0,
    });
    expect(
      await prisma.inventoryLedger.count({
        where: { referenceId: orderId, type: 'RESERVE' },
      }),
    ).toBe(1);
  });

  it('does not recreate ACTIVE after a successful release', async () => {
    const productId = await stockProduct(5);
    const orderId = randomUUID();
    await inventory.reserveForOrder({
      orderId,
      lines: [{ productId, quantity: 2 }],
      actor: SYSTEM_ACTOR,
    });
    await inventory.releaseForOrder({ orderId, actor: SYSTEM_ACTOR });

    await expect(
      inventory.reserveForOrder({
        orderId,
        lines: [{ productId, quantity: 2 }],
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toBeInstanceOf(InventoryReservationConflictError);

    expect(await inventory.getBalance(productId)).toMatchObject({
      onHand: 5,
      reserved: 0,
    });
    expect(
      await prisma.inventoryLedger.count({
        where: { productId, type: 'RESERVE', referenceId: orderId },
      }),
    ).toBe(1);
  });

  it('releases a multi-SKU order once under concurrent releaseForOrder calls', async () => {
    const first = await stockProduct(6);
    const second = await stockProduct(4);
    const orderId = randomUUID();
    await inventory.reserveForOrder({
      orderId,
      lines: [
        { productId: first, quantity: 2 },
        { productId: second, quantity: 1 },
      ],
      actor: SYSTEM_ACTOR,
    });

    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        inventory.releaseForOrder({ orderId, actor: SYSTEM_ACTOR }),
      ),
    );

    expect(outcomes.every((row) => row.status === 'fulfilled')).toBe(true);
    expect(await inventory.getBalance(first)).toMatchObject({ reserved: 0 });
    expect(await inventory.getBalance(second)).toMatchObject({ reserved: 0 });
    expect(
      await prisma.inventoryLedger.count({
        where: { referenceId: orderId, type: 'RELEASE' },
      }),
    ).toBe(2);
  });

  it('conflicts a later line addition against an existing ACTIVE subset', async () => {
    const first = await stockProduct(5);
    const second = await stockProduct(5);
    const orderId = randomUUID();
    await inventory.reserveForOrder({
      orderId,
      lines: [{ productId: first, quantity: 1 }],
      actor: SYSTEM_ACTOR,
    });

    await expect(
      inventory.reserveForOrder({
        orderId,
        lines: [
          { productId: first, quantity: 1 },
          { productId: second, quantity: 1 },
        ],
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toBeInstanceOf(InventoryReservationConflictError);

    expect(await inventory.getBalance(first)).toMatchObject({ reserved: 1 });
    expect(await inventory.getBalance(second)).toMatchObject({ reserved: 0 });
    expect(
      await prisma.inventoryReservation.count({ where: { orderId } }),
    ).toBe(1);
  });

  it('never lets concurrent reserve and a below-reserved adjust violate invariants', async () => {
    const productId = await stockProduct(10);
    const outcomes = await Promise.allSettled([
      inventory.reserveForOrder({
        orderId: randomUUID(),
        lines: [{ productId, quantity: 8 }],
        actor: SYSTEM_ACTOR,
      }),
      inventory.adjustOnHand({
        productId,
        delta: -4,
        referenceType: InventoryLedgerReferenceType.ADJUSTMENT,
        referenceId: randomUUID(),
        reason: 'cycle count',
        actor: SYSTEM_ACTOR,
      }),
    ]);

    expect(
      outcomes.filter((row) => row.status === 'fulfilled').length,
    ).toBeGreaterThanOrEqual(1);
    const finalBalance = await inventory.getBalance(productId);
    expect(finalBalance).not.toBeNull();
    expect(finalBalance!.reserved).toBeLessThanOrEqual(finalBalance!.onHand);
    expect(finalBalance!.reserved).toBeGreaterThanOrEqual(0);
    expect(finalBalance!.onHand === 6 && finalBalance!.reserved === 8).toBe(
      false,
    );
    expect([
      { onHand: 10, reserved: 8 },
      { onHand: 6, reserved: 0 },
    ]).toContainEqual({
      onHand: finalBalance!.onHand,
      reserved: finalBalance!.reserved,
    });
  });

  it('serializes release against a concurrent on-hand adjustment safely', async () => {
    const productId = await stockProduct(10);
    const orderId = randomUUID();
    await inventory.reserveForOrder({
      orderId,
      lines: [{ productId, quantity: 8 }],
      actor: SYSTEM_ACTOR,
    });

    const outcomes = await Promise.allSettled([
      inventory.releaseForOrder({ orderId, actor: SYSTEM_ACTOR }),
      inventory.adjustOnHand({
        productId,
        delta: -4,
        referenceType: InventoryLedgerReferenceType.ADJUSTMENT,
        referenceId: randomUUID(),
        reason: 'cycle count',
        actor: SYSTEM_ACTOR,
      }),
    ]);

    expect(
      outcomes.filter((row) => row.status === 'fulfilled').length,
    ).toBeGreaterThanOrEqual(1);
    const finalBalance = await inventory.getBalance(productId);
    expect(finalBalance).not.toBeNull();
    expect(finalBalance!.reserved).toBeLessThanOrEqual(finalBalance!.onHand);
    expect(finalBalance!.onHand).toBeGreaterThanOrEqual(0);
    expect(finalBalance!.reserved).toBeGreaterThanOrEqual(0);
  });

  it('rolls back reservation, ledger, and balance when the outer transaction fails', async () => {
    const productId = await stockProduct(6);
    const orderId = randomUUID();

    await expect(
      transactions.run(async (tx) => {
        await inventory.reserveForOrder(
          {
            orderId,
            lines: [{ productId, quantity: 2 }],
            actor: SYSTEM_ACTOR,
          },
          tx,
        );
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    expect(await inventory.getBalance(productId)).toMatchObject({
      onHand: 6,
      reserved: 0,
    });
    expect(
      await prisma.inventoryReservation.count({ where: { orderId } }),
    ).toBe(0);
    expect(
      await prisma.inventoryLedger.count({
        where: { referenceId: orderId },
      }),
    ).toBe(0);
  });

  it('leaves no residue from a failed reserve and appends RESERVE once on success', async () => {
    const productId = await stockProduct(1);
    await expect(
      inventory.reserveForOrder({
        orderId: randomUUID(),
        lines: [{ productId, quantity: 5 }],
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toBeInstanceOf(InventoryInsufficientStockError);
    await assertNoResidue([productId]);

    const orderId = randomUUID();
    await inventory.reserveForOrder({
      orderId,
      lines: [{ productId, quantity: 1 }],
      actor: SYSTEM_ACTOR,
    });
    await inventory.reserveForOrder({
      orderId,
      lines: [{ productId, quantity: 1 }],
      actor: SYSTEM_ACTOR,
    });
    expect(
      await prisma.inventoryLedger.count({
        where: { productId, type: 'RESERVE' },
      }),
    ).toBe(1);
  });

  it('serializes an identical reserve replay against release of an ACTIVE order', async () => {
    const productId = await stockProduct(6);
    const orderId = randomUUID();
    await inventory.reserveForOrder({
      orderId,
      lines: [{ productId, quantity: 2 }],
      actor: SYSTEM_ACTOR,
    });

    const outcomes = await Promise.allSettled([
      inventory.reserveForOrder({
        orderId,
        lines: [{ productId, quantity: 2 }],
        actor: SYSTEM_ACTOR,
      }),
      inventory.releaseForOrder({ orderId, actor: SYSTEM_ACTOR }),
    ]);

    const rows = await prisma.inventoryReservation.findMany({
      where: { orderId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('RELEASED');
    expect(await inventory.getBalance(productId)).toMatchObject({
      onHand: 6,
      reserved: 0,
    });
    expect(
      await prisma.inventoryLedger.count({
        where: { productId, type: 'RESERVE', referenceId: orderId },
      }),
    ).toBe(1);
    expect(
      await prisma.inventoryLedger.count({
        where: { productId, type: 'RELEASE', referenceId: orderId },
      }),
    ).toBe(1);

    const fulfilled = outcomes.filter((row) => row.status === 'fulfilled');
    const rejected = outcomes.filter((row) => row.status === 'rejected');
    expect(fulfilled.length + rejected.length).toBe(2);
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const row of rejected) {
      if (row.status === 'rejected') {
        expect(row.reason).toBeInstanceOf(InventoryReservationConflictError);
      }
    }
  });

  it('fails closed when reserve and release race the same unused order', async () => {
    const productId = await stockProduct(6);
    const orderId = randomUUID();

    const outcomes = await Promise.allSettled([
      inventory.reserveForOrder({
        orderId,
        lines: [{ productId, quantity: 2 }],
        actor: SYSTEM_ACTOR,
      }),
      inventory.releaseForOrder({ orderId, actor: SYSTEM_ACTOR }),
    ]);

    const reserved = await inventory.getBalance(productId);
    expect(reserved).not.toBeNull();
    expect(reserved!.reserved).toBeGreaterThanOrEqual(0);
    expect(reserved!.reserved).toBeLessThanOrEqual(reserved!.onHand);

    const rows = await prisma.inventoryReservation.findMany({
      where: { orderId },
    });
    expect(rows).toHaveLength(1);
    const status = rows[0]!.status;
    expect(['ACTIVE', 'RELEASED']).toContain(status);
    if (status === 'ACTIVE') {
      expect(reserved!.reserved).toBe(2);
      expect(
        outcomes.some(
          (row) =>
            row.status === 'rejected' &&
            row.reason instanceof InventoryReservationNotFoundError,
        ),
      ).toBe(true);
    } else {
      expect(reserved!.reserved).toBe(0);
      expect(outcomes.filter((row) => row.status === 'fulfilled')).toHaveLength(
        2,
      );
    }
  });
});

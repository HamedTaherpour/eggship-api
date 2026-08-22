import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { PrismaModule } from '../../../src/infrastructure/database/prisma/prisma.module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { TransactionRunner } from '../../../src/infrastructure/database/transaction';
import { CategoryRepository } from '../../../src/modules/categories/infrastructure/category.repository';
import { CategoryService } from '../../../src/modules/categories/application/category.service';
import {
  InventoryService,
  SYSTEM_ACTOR,
} from '../../../src/modules/inventory/application/inventory.service';
import {
  InventoryInvalidAdjustmentError,
  InventoryReservationConflictError,
} from '../../../src/modules/inventory/domain/inventory-errors';
import { InventoryHttpMessage } from '../../../src/modules/inventory/domain/inventory-http-messages';
import { InventoryLedgerReferenceType } from '../../../src/modules/inventory/domain/inventory-ledger';
import { InventoryModule } from '../../../src/modules/inventory/inventory.module';
import { ProductService } from '../../../src/modules/products/application/product.service';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

async function truncateInventoryTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "InventoryLedger", "InventoryReservation", "Inventory", "Product", "Category" RESTART IDENTITY CASCADE',
  );
}

describe('Inventory ship (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let categories: CategoryRepository;
  let productService: ProductService;
  let inventory: InventoryService;
  let transactions: TransactionRunner;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        PrismaModule,
        InventoryModule,
      ],
      providers: [CategoryRepository, CategoryService, ProductService],
    }).compile();

    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    categories = moduleRef.get(CategoryRepository);
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

  async function reserveOrder(input: {
    orderId: string;
    lines: Array<{ productId: string; quantity: number }>;
  }): Promise<void> {
    await inventory.reserveForOrder({
      orderId: input.orderId,
      lines: input.lines,
      actor: SYSTEM_ACTOR,
    });
  }

  it('ships a single ACTIVE reservation and decrements onHand and reserved', async () => {
    const productId = await stockProduct(10);
    const orderId = randomUUID();
    await reserveOrder({
      orderId,
      lines: [{ productId, quantity: 3 }],
    });

    const before = await inventory.getBalance(productId);
    const availableBefore = before!.available;

    const result = await inventory.shipForOrder({
      orderId,
      actor: SYSTEM_ACTOR,
    });

    expect(result).toEqual({
      orderId,
      lines: [{ productId, quantity: 3, status: 'SHIPPED' }],
    });
    const after = await inventory.getBalance(productId);
    expect(after).toMatchObject({ onHand: 7, reserved: 0, available: 7 });
    expect(after!.available).toBe(availableBefore);
    expect(
      await prisma.inventoryLedger.count({
        where: { productId, type: 'SHIP', referenceId: orderId },
      }),
    ).toBe(1);
  });

  it('ships multiple SKUs atomically', async () => {
    const first = await stockProduct(10);
    const second = await stockProduct(8);
    const third = await stockProduct(5);
    const orderId = randomUUID();
    await reserveOrder({
      orderId,
      lines: [
        { productId: first, quantity: 3 },
        { productId: second, quantity: 5 },
        { productId: third, quantity: 2 },
      ],
    });

    const result = await inventory.shipForOrder({
      orderId,
      actor: SYSTEM_ACTOR,
    });

    expect(result.lines).toHaveLength(3);
    expect(result.lines.every((line) => line.status === 'SHIPPED')).toBe(true);
    expect(await inventory.getBalance(first)).toMatchObject({
      onHand: 7,
      reserved: 0,
    });
    expect(await inventory.getBalance(second)).toMatchObject({
      onHand: 3,
      reserved: 0,
    });
    expect(await inventory.getBalance(third)).toMatchObject({
      onHand: 3,
      reserved: 0,
    });
    expect(
      await prisma.inventoryLedger.count({
        where: { referenceId: orderId, type: 'SHIP' },
      }),
    ).toBe(3);
  });

  it('replays ship idempotently without a second aggregate or ledger write', async () => {
    const productId = await stockProduct(8);
    const orderId = randomUUID();
    await reserveOrder({
      orderId,
      lines: [{ productId, quantity: 3 }],
    });
    await inventory.shipForOrder({ orderId, actor: SYSTEM_ACTOR });

    const replay = await inventory.shipForOrder({
      orderId,
      actor: SYSTEM_ACTOR,
    });

    expect(replay.lines.every((line) => line.status === 'SHIPPED')).toBe(true);
    expect(await inventory.getBalance(productId)).toMatchObject({
      onHand: 5,
      reserved: 0,
    });
    expect(
      await prisma.inventoryLedger.count({
        where: { productId, type: 'SHIP', referenceId: orderId },
      }),
    ).toBe(1);
  });

  it('returns not found and writes nothing when no reservation exists', async () => {
    const productId = await stockProduct(5);
    const orderId = randomUUID();

    await expect(
      inventory.shipForOrder({ orderId, actor: SYSTEM_ACTOR }),
    ).rejects.toMatchObject({
      code: 'INVENTORY_RESERVATION_NOT_FOUND',
      message: InventoryHttpMessage.RESERVATION_NOT_FOUND,
    });

    expect(await inventory.getBalance(productId)).toMatchObject({
      onHand: 5,
      reserved: 0,
    });
    expect(
      await prisma.inventoryLedger.count({ where: { type: 'SHIP' } }),
    ).toBe(0);
  });

  it('conflicts when every row is RELEASED', async () => {
    const productId = await stockProduct(8);
    const orderId = randomUUID();
    await reserveOrder({
      orderId,
      lines: [{ productId, quantity: 3 }],
    });
    await inventory.releaseForOrder({ orderId, actor: SYSTEM_ACTOR });

    await expect(
      inventory.shipForOrder({ orderId, actor: SYSTEM_ACTOR }),
    ).rejects.toMatchObject({
      code: 'INVENTORY_RESERVATION_CONFLICT',
      message: InventoryHttpMessage.SHIP_RESERVATION_CONFLICT,
    });
    expect(await inventory.getBalance(productId)).toMatchObject({
      onHand: 8,
      reserved: 0,
    });
    expect(
      await prisma.inventoryLedger.count({
        where: { referenceId: orderId, type: 'SHIP' },
      }),
    ).toBe(0);
  });

  it('conflicts on mixed ACTIVE/SHIPPED instead of shipping the remainder', async () => {
    const first = await stockProduct(5);
    const second = await stockProduct(5);
    const orderId = randomUUID();
    await reserveOrder({
      orderId,
      lines: [
        { productId: first, quantity: 1 },
        { productId: second, quantity: 1 },
      ],
    });
    await inventory.shipReservation({
      orderId,
      productId: first,
      actor: SYSTEM_ACTOR,
    });

    await expect(
      inventory.shipForOrder({ orderId, actor: SYSTEM_ACTOR }),
    ).rejects.toBeInstanceOf(InventoryReservationConflictError);

    expect(await inventory.getBalance(first)).toMatchObject({
      onHand: 4,
      reserved: 0,
    });
    expect(await inventory.getBalance(second)).toMatchObject({
      onHand: 5,
      reserved: 1,
    });
    expect(
      await prisma.inventoryLedger.count({
        where: { referenceId: orderId, type: 'SHIP' },
      }),
    ).toBe(1);
  });

  it('conflicts on mixed ACTIVE/RELEASED', async () => {
    const first = await stockProduct(5);
    const second = await stockProduct(5);
    const orderId = randomUUID();
    await prisma.inventoryReservation.createMany({
      data: [
        { orderId, productId: first, quantity: 1, status: 'ACTIVE' },
        { orderId, productId: second, quantity: 1, status: 'RELEASED' },
      ],
    });
    await prisma.inventory.update({
      where: { productId: first },
      data: { reserved: 1 },
    });

    await expect(
      inventory.shipForOrder({ orderId, actor: SYSTEM_ACTOR }),
    ).rejects.toBeInstanceOf(InventoryReservationConflictError);
    expect(await inventory.getBalance(first)).toMatchObject({ reserved: 1 });
    expect(
      await prisma.inventoryLedger.count({
        where: { referenceId: orderId, type: 'SHIP' },
      }),
    ).toBe(0);
  });

  it('treats 20 concurrent same-order ship calls as one physical mutation', async () => {
    const first = await stockProduct(10);
    const second = await stockProduct(10);
    const orderId = randomUUID();
    await reserveOrder({
      orderId,
      lines: [
        { productId: first, quantity: 2 },
        { productId: second, quantity: 1 },
      ],
    });

    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        inventory.shipForOrder({ orderId, actor: SYSTEM_ACTOR }),
      ),
    );

    expect(outcomes.every((row) => row.status === 'fulfilled')).toBe(true);
    expect(await inventory.getBalance(first)).toMatchObject({
      onHand: 8,
      reserved: 0,
    });
    expect(await inventory.getBalance(second)).toMatchObject({
      onHand: 9,
      reserved: 0,
    });
    expect(
      await prisma.inventoryLedger.count({
        where: { referenceId: orderId, type: 'SHIP' },
      }),
    ).toBe(2);
    expect(
      await prisma.inventoryReservation.findMany({ where: { orderId } }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: first, status: 'SHIPPED' }),
        expect.objectContaining({ productId: second, status: 'SHIPPED' }),
      ]),
    );
  });

  it('serializes ship against release for the same order', async () => {
    const productId = await stockProduct(10);
    const orderId = randomUUID();
    await reserveOrder({
      orderId,
      lines: [{ productId, quantity: 4 }],
    });

    const outcomes = await Promise.allSettled([
      inventory.shipForOrder({ orderId, actor: SYSTEM_ACTOR }),
      inventory.releaseForOrder({ orderId, actor: SYSTEM_ACTOR }),
    ]);

    const rows = await prisma.inventoryReservation.findMany({
      where: { orderId },
    });
    expect(rows).toHaveLength(1);
    const status = rows[0]!.status;
    expect(['SHIPPED', 'RELEASED']).toContain(status);

    const balance = await inventory.getBalance(productId);
    if (status === 'SHIPPED') {
      expect(balance).toMatchObject({ onHand: 6, reserved: 0 });
      expect(
        await prisma.inventoryLedger.count({
          where: { referenceId: orderId, type: 'SHIP' },
        }),
      ).toBe(1);
      expect(
        await prisma.inventoryLedger.count({
          where: { referenceId: orderId, type: 'RELEASE' },
        }),
      ).toBe(0);
      expect(
        outcomes.some(
          (row) =>
            row.status === 'rejected' &&
            row.reason instanceof InventoryReservationConflictError,
        ),
      ).toBe(true);
    } else {
      expect(balance).toMatchObject({ onHand: 10, reserved: 0 });
      expect(
        await prisma.inventoryLedger.count({
          where: { referenceId: orderId, type: 'RELEASE' },
        }),
      ).toBe(1);
      expect(
        await prisma.inventoryLedger.count({
          where: { referenceId: orderId, type: 'SHIP' },
        }),
      ).toBe(0);
      expect(
        outcomes.some(
          (row) =>
            row.status === 'rejected' &&
            row.reason instanceof InventoryReservationConflictError,
        ),
      ).toBe(true);
    }
  });

  it('serializes ship against a concurrent on-hand adjustment safely', async () => {
    const productId = await stockProduct(10);
    const orderId = randomUUID();
    await reserveOrder({
      orderId,
      lines: [{ productId, quantity: 8 }],
    });

    const outcomes = await Promise.allSettled([
      inventory.shipForOrder({ orderId, actor: SYSTEM_ACTOR }),
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
    expect(finalBalance!.onHand === 6 && finalBalance!.reserved === 8).toBe(
      false,
    );
    expect(finalBalance).toMatchObject({ onHand: 2, reserved: 0 });
    expect(outcomes.some((row) => row.status === 'fulfilled')).toBe(true);
  });

  it('allows concurrent ship and another order reserve without false oversell', async () => {
    const productId = await stockProduct(10);
    const orderA = randomUUID();
    const orderB = randomUUID();
    await reserveOrder({
      orderId: orderA,
      lines: [{ productId, quantity: 8 }],
    });

    const outcomes = await Promise.allSettled([
      inventory.shipForOrder({ orderId: orderA, actor: SYSTEM_ACTOR }),
      inventory.reserveForOrder({
        orderId: orderB,
        lines: [{ productId, quantity: 2 }],
        actor: SYSTEM_ACTOR,
      }),
    ]);

    expect(outcomes.every((row) => row.status === 'fulfilled')).toBe(true);
    const finalBalance = await inventory.getBalance(productId);
    expect(finalBalance).toMatchObject({
      onHand: 6,
      reserved: 2,
      available: 4,
    });
    expect(finalBalance!.reserved).toBeLessThanOrEqual(finalBalance!.onHand);
  });

  it('rolls back ship, ledger, and balance when the outer transaction fails', async () => {
    const productId = await stockProduct(6);
    const orderId = randomUUID();
    await reserveOrder({
      orderId,
      lines: [{ productId, quantity: 2 }],
    });

    await expect(
      transactions.run(async (tx) => {
        await inventory.shipForOrder({ orderId, actor: SYSTEM_ACTOR }, tx);
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    expect(await inventory.getBalance(productId)).toMatchObject({
      onHand: 6,
      reserved: 2,
    });
    expect(
      await prisma.inventoryReservation.findMany({ where: { orderId } }),
    ).toEqual([
      expect.objectContaining({ productId, status: 'ACTIVE', quantity: 2 }),
    ]);
    expect(
      await prisma.inventoryLedger.count({
        where: { referenceId: orderId, type: 'SHIP' },
      }),
    ).toBe(0);
  });

  it('leaves no partial mutation when one line cannot ship', async () => {
    const first = await stockProduct(10);
    const second = await stockProduct(10);
    const orderId = randomUUID();
    await reserveOrder({
      orderId,
      lines: [
        { productId: first, quantity: 3 },
        { productId: second, quantity: 2 },
      ],
    });

    await prisma.inventory.update({
      where: { productId: second },
      data: { onHand: 1 },
    });

    await expect(
      inventory.shipForOrder({ orderId, actor: SYSTEM_ACTOR }),
    ).rejects.toBeInstanceOf(InventoryInvalidAdjustmentError);

    expect(await inventory.getBalance(first)).toMatchObject({
      onHand: 10,
      reserved: 3,
    });
    expect(await inventory.getBalance(second)).toMatchObject({
      onHand: 1,
      reserved: 2,
    });
    expect(
      await prisma.inventoryReservation.findMany({ where: { orderId } }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: first, status: 'ACTIVE' }),
        expect.objectContaining({ productId: second, status: 'ACTIVE' }),
      ]),
    );
    expect(
      await prisma.inventoryLedger.count({
        where: { referenceId: orderId, type: 'SHIP' },
      }),
    ).toBe(0);
  });

  it('keeps available unchanged when shipping already-reserved stock', async () => {
    const productId = await stockProduct(10);
    const orderId = randomUUID();
    await reserveOrder({
      orderId,
      lines: [{ productId, quantity: 4 }],
    });
    const before = await inventory.getBalance(productId);
    expect(before!.available).toBe(6);

    await inventory.shipForOrder({ orderId, actor: SYSTEM_ACTOR });

    const after = await inventory.getBalance(productId);
    expect(after!.available).toBe(before!.available);
    expect(after).toMatchObject({ onHand: 6, reserved: 0, available: 6 });
  });

  it('writes SHIP ledger with correct deltas and after-balances', async () => {
    const productId = await stockProduct(10);
    const orderId = randomUUID();
    await reserveOrder({
      orderId,
      lines: [{ productId, quantity: 4 }],
    });

    await inventory.shipForOrder({ orderId, actor: SYSTEM_ACTOR });

    const entry = await prisma.inventoryLedger.findFirst({
      where: { productId, type: 'SHIP', referenceId: orderId },
    });
    expect(entry).toMatchObject({
      quantity: 4,
      onHandDelta: -4,
      reservedDelta: -4,
      onHandAfter: 6,
      reservedAfter: 0,
      referenceType: 'ORDER',
    });
  });
});

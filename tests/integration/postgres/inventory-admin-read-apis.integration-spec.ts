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
import { AdminInventoryQueryService } from '../../../src/modules/inventory/application/admin-inventory-query.service';
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
  InventoryLedgerReferenceType,
  InventoryLedgerType,
} from '../../../src/modules/inventory/domain/inventory-ledger';
import { InventoryReservationStatus } from '../../../src/modules/inventory/domain/inventory-reservation';
import { InventoryModule } from '../../../src/modules/inventory/inventory.module';
import { ProductService } from '../../../src/modules/products/application/product.service';
import { ProductRepository } from '../../../src/modules/products/infrastructure/product.repository';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

async function truncateInventoryTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "InventoryLedger", "InventoryReservation", "Inventory", "Product", "Category" RESTART IDENTITY CASCADE',
  );
}

describe('Admin inventory read APIs (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let categories: CategoryRepository;
  let productService: ProductService;
  let inventory: InventoryService;
  let queries: AdminInventoryQueryService;

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
    productService = moduleRef.get(ProductService);
    inventory = moduleRef.get(InventoryService);
    queries = moduleRef.get(AdminInventoryQueryService);
    await app.init();
  });

  beforeEach(async () => {
    await truncateInventoryTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createProduct(input: {
    name: string;
    isActive?: boolean;
    onHand?: number;
  }): Promise<string> {
    const category = await categories.create({ name: `Cat ${randomUUID()}` });
    const product = await productService.create({
      name: input.name,
      price: 1000,
      categoryId: category.id,
      isActive: input.isActive,
    });
    if ((input.onHand ?? 0) > 0) {
      await inventory.receiveOnHand({
        productId: product.id,
        quantity: input.onHand!,
        referenceType: InventoryLedgerReferenceType.RECEIVE,
        referenceId: randomUUID(),
        actor: SYSTEM_ACTOR,
      });
    }
    return product.id;
  }

  it('lists inventory joined with Product without per-row N+1 queries', async () => {
    await createProduct({ name: 'Alpha eggs', onHand: 10 });
    await createProduct({ name: 'Beta eggs', onHand: 20, isActive: false });

    const countSpy = jest.spyOn(prisma.inventory, 'count');
    const findManySpy = jest.spyOn(prisma.inventory, 'findMany');

    const page = await queries.listAdmin({
      page: 1,
      pageSize: 10,
      sortBy: 'productName',
      sortOrder: 'asc',
    });

    expect(page.meta.total).toBe(2);
    expect(page.data).toHaveLength(2);
    expect(page.data[0]!.available).toBe(
      page.data[0]!.onHand - page.data[0]!.reserved,
    );
    expect(countSpy).toHaveBeenCalledTimes(1);
    expect(findManySpy).toHaveBeenCalledTimes(1);

    countSpy.mockRestore();
    findManySpy.mockRestore();
  });

  it('searches Product name, filters isActive, sorts by onHand, and paginates', async () => {
    await createProduct({ name: 'Alpha eggs', onHand: 5 });
    await createProduct({ name: 'Beta eggs', onHand: 30, isActive: false });
    await createProduct({ name: 'Gamma milk', onHand: 15 });

    const page = await queries.listAdmin({
      page: 1,
      pageSize: 1,
      search: 'eggs',
      sortBy: 'onHand',
      sortOrder: 'desc',
      isActive: true,
    });

    expect(page.meta).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 1,
      totalPages: 1,
    });
    expect(page.data[0]).toMatchObject({
      productName: 'Alpha eggs',
      onHand: 5,
      available: 5,
    });
  });

  it('sorts by derived available using static SQL expression', async () => {
    const low = await createProduct({ name: 'Low avail', onHand: 10 });
    const high = await createProduct({ name: 'High avail', onHand: 50 });
    await inventory.reserveForOrder({
      orderId: randomUUID(),
      lines: [{ productId: low, quantity: 8 }],
      actor: SYSTEM_ACTOR,
    });

    const page = await queries.listAdmin({
      page: 1,
      pageSize: 10,
      sortBy: 'available',
      sortOrder: 'desc',
    });

    expect(page.data[0]!.productId).toBe(high);
    expect(page.data[page.data.length - 1]!.productId).toBe(low);
  });

  it('paginates ledger newest-first with stable id tie-breaker and filters type', async () => {
    const productId = await createProduct({
      name: 'Ledger product',
      onHand: 0,
    });
    await inventory.receiveOnHand({
      productId,
      quantity: 5,
      referenceType: InventoryLedgerReferenceType.RECEIVE,
      referenceId: randomUUID(),
      actor: SYSTEM_ACTOR,
    });
    await inventory.adjustOnHand({
      productId,
      delta: -1,
      reason: 'count',
      referenceType: InventoryLedgerReferenceType.ADJUSTMENT,
      referenceId: randomUUID(),
      actor: SYSTEM_ACTOR,
    });

    const page = await queries.listLedger(productId, {
      page: 1,
      pageSize: 1,
      type: InventoryLedgerType.ADJUST,
    });

    expect(page.meta.total).toBe(1);
    expect(page.data).toHaveLength(1);
    expect(page.data[0]!.type).toBe(InventoryLedgerType.ADJUST);
  });

  it('filters reservations by status', async () => {
    const productId = await createProduct({ name: 'Reserved', onHand: 20 });
    const activeOrder = randomUUID();
    const releasedOrder = randomUUID();
    await inventory.reserveForOrder({
      orderId: activeOrder,
      lines: [{ productId, quantity: 3 }],
      actor: SYSTEM_ACTOR,
    });
    await inventory.reserveForOrder({
      orderId: releasedOrder,
      lines: [{ productId, quantity: 2 }],
      actor: SYSTEM_ACTOR,
    });
    await inventory.releaseForOrder({
      orderId: releasedOrder,
      actor: SYSTEM_ACTOR,
    });

    const page = await queries.listReservations(productId, {
      page: 1,
      pageSize: 10,
      status: InventoryReservationStatus.ACTIVE,
    });

    expect(page.meta.total).toBe(1);
    expect(page.data[0]).toMatchObject({
      orderId: activeOrder,
      status: InventoryReservationStatus.ACTIVE,
    });
  });

  it('exposes reconciliation through query service wiring', async () => {
    const productId = await createProduct({ name: 'Consistent', onHand: 12 });
    const result = await queries.reconcileProduct(productId);
    expect(result.status).toBe(InventoryReconciliationStatus.CONSISTENT);
  });

  it('returns inconsistent reconciliation without throwing', async () => {
    const productId = await createProduct({ name: 'Broken', onHand: 10 });
    await prisma.$executeRaw`
      UPDATE "Inventory"
      SET "onHand" = 99
      WHERE "productId" = ${productId}::uuid
    `;
    const result = await queries.reconcileProduct(productId);
    expect(result.status).toBe(InventoryReconciliationStatus.INCONSISTENT);
    expect(
      result.issues.some(
        (issue) =>
          issue.code ===
          InventoryReconciliationIssueCode.LEDGER_BALANCE_MISMATCH,
      ),
    ).toBe(true);
  });

  it('throws INVENTORY_NOT_FOUND for missing inventory on diagnostics', async () => {
    await expect(
      queries.listLedger(randomUUID(), { page: 1, pageSize: 10 }),
    ).rejects.toBeInstanceOf(InventoryNotFoundError);
  });

  it('never mutates rows during read queries', async () => {
    const productId = await createProduct({ name: 'Read-only', onHand: 8 });
    const orderId = randomUUID();
    await inventory.reserveForOrder({
      orderId,
      lines: [{ productId, quantity: 2 }],
      actor: SYSTEM_ACTOR,
    });

    const beforeInventory = await prisma.inventory.findUnique({
      where: { productId },
    });
    const ledgerBefore = await prisma.inventoryLedger.count({
      where: { productId },
    });
    const reservationBefore = await prisma.inventoryReservation.count({
      where: { productId },
    });

    await queries.listAdmin({
      page: 1,
      pageSize: 10,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });
    await queries.listLedger(productId, { page: 1, pageSize: 10 });
    await queries.listReservations(productId, { page: 1, pageSize: 10 });
    await queries.reconcileProduct(productId);

    expect(await prisma.inventory.findUnique({ where: { productId } })).toEqual(
      beforeInventory,
    );
    expect(await prisma.inventoryLedger.count({ where: { productId } })).toBe(
      ledgerBefore,
    );
    expect(
      await prisma.inventoryReservation.count({ where: { productId } }),
    ).toBe(reservationBefore);
  });
});

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
import { InventoryModule } from '../../../src/modules/inventory/inventory.module';
import { OrderActorType } from '../../../src/modules/orders/domain/order-actor';
import { OrderErrorCode } from '../../../src/modules/orders/domain/order-errors';
import { OrderStatus } from '../../../src/modules/orders/domain/order-status';
import {
  BulkOrderTransitionAction,
  BulkOrderTransitionService,
} from '../../../src/modules/orders/application/bulk-order-transition.service';
import { OrderTransitionService } from '../../../src/modules/orders/application/order-transition.service';
import { OrderRepository } from '../../../src/modules/orders/infrastructure/order.repository';
import { OrdersModule } from '../../../src/modules/orders/orders.module';
import { AuditModule } from '../../../src/modules/audit/audit.module';
import { ProductService } from '../../../src/modules/products/application/product.service';
import { ProductRepository } from '../../../src/modules/products/infrastructure/product.repository';
import { RegionRepository } from '../../../src/modules/regions/infrastructure/region.repository';
import { UserRepository } from '../../../src/modules/users/infrastructure/user.repository';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';
import { AuditAction } from '../../../src/modules/audit/domain/audit-event';

function uniquePhone(suffix: number): string {
  const national = `912${String(suffix).padStart(7, '0')}`.slice(0, 10);
  return `+98${national}`;
}

async function truncateBulkTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "OutboxEvent", "DiscountUsageRecord", "DiscountCustomerUsage", "InventoryLedger", "InventoryReservation", "Inventory", "OrderLine", "Order", "Product", "Category", "Region", "User" RESTART IDENTITY CASCADE',
  );
}

describe('ORD-07 bulk transitions (PostgreSQL integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let users: UserRepository;
  let regions: RegionRepository;
  let categories: CategoryRepository;
  let productService: ProductService;
  let orders: OrderRepository;
  let transitions: OrderTransitionService;
  let bulk: BulkOrderTransitionService;
  let inventory: InventoryService;
  let phoneCounter = 0;

  const admin = {
    type: OrderActorType.ADMIN,
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  } as const;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ...postgresIntegrationImports([
          InventoryModule,
          OrdersModule,
          AuditModule,
        ]),
      ],
      providers: [
        RegionRepository,
        CategoryRepository,
        CategoryService,
        ProductRepository,
        ProductService,
        unusedPricingServiceProvider(),
      ],
    }).compile();

    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    users = moduleRef.get(UserRepository);
    regions = moduleRef.get(RegionRepository);
    categories = moduleRef.get(CategoryRepository);
    productService = moduleRef.get(ProductService);
    orders = moduleRef.get(OrderRepository);
    transitions = moduleRef.get(OrderTransitionService);
    bulk = moduleRef.get(BulkOrderTransitionService);
    inventory = moduleRef.get(InventoryService);
    await app.init();
  });

  beforeEach(async () => {
    await truncateBulkTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  function nextPhone(): string {
    phoneCounter += 1;
    return uniquePhone(phoneCounter + (Date.now() % 1_000_000));
  }

  async function seedReservedPending(options?: {
    onHand?: number;
    quantity?: number;
  }): Promise<{ orderId: string; productId: string; quantity: number }> {
    const onHand = options?.onHand ?? 20;
    const quantity = options?.quantity ?? 2;
    const user = await users.create({ phone: nextPhone() });
    const region = await regions.create({ name: `Region ${randomUUID()}` });
    const category = await categories.create({ name: `Cat ${randomUUID()}` });
    const product = await productService.create({
      name: `Eggs ${randomUUID()}`,
      price: 1000,
      categoryId: category.id,
    });
    await inventory.receiveOnHand({
      productId: product.id,
      quantity: onHand,
      referenceType: InventoryLedgerReferenceType.RECEIVE,
      referenceId: randomUUID(),
      actor: SYSTEM_ACTOR,
    });
    const gross = BigInt(product.price) * BigInt(quantity);
    const created = await orders.createWithTrustedSnapshots({
      userId: user.id,
      customerPhone: user.phone,
      regionId: region.id,
      regionName: region.name,
      idempotencyKey: randomUUID(),
      idempotencyPayloadHash: 'b'.repeat(64),
      pricingEvaluatedAt: new Date('2026-09-02T12:00:00.000Z'),
      commercePolicyRevision: 1,
      grossSubtotal: gross,
      lineDiscountTotal: 0n,
      subtotalAfterLineDiscounts: gross,
      orderDiscountAmount: 0n,
      total: gross,
      appliedOrderDiscount: null,
      lines: [
        {
          productId: product.id,
          productName: product.name,
          unitPrice: product.price,
          quantity,
          discountedQuantity: 0,
          grossLineTotal: gross,
          lineDiscountAmount: 0n,
          finalLineTotal: gross,
          appliedLineDiscount: null,
        },
      ],
    });
    await inventory.reserveForOrder({
      orderId: created.id,
      lines: [{ productId: product.id, quantity }],
      actor: SYSTEM_ACTOR,
    });
    return { orderId: created.id, productId: product.id, quantity };
  }

  async function seedConfirmed(): Promise<{
    orderId: string;
    productId: string;
    quantity: number;
  }> {
    const seeded = await seedReservedPending();
    await transitions.confirmOrder({ orderId: seeded.orderId, actor: admin });
    return seeded;
  }

  async function seedShipped(): Promise<{
    orderId: string;
    productId: string;
    quantity: number;
  }> {
    const seeded = await seedConfirmed();
    await transitions.shipOrder({ orderId: seeded.orderId, actor: admin });
    return seeded;
  }

  it('partial-success bulk SHIP preserves independent commits and request order', async () => {
    const a = await seedConfirmed();
    const b = await seedConfirmed();
    await transitions.shipOrder({ orderId: b.orderId, actor: admin });
    const c = await seedReservedPending(); // PENDING_REVIEW — invalid for SHIP
    const unknownId = randomUUID();
    const e = await seedConfirmed();

    const result = await bulk.execute({
      action: BulkOrderTransitionAction.SHIP,
      orderIds: [a.orderId, b.orderId, c.orderId, unknownId, e.orderId],
      actor: admin,
    });

    expect(result.summary).toEqual({ requested: 5, succeeded: 3, failed: 2 });
    expect(result.results.map((item) => item.orderId)).toEqual([
      a.orderId,
      b.orderId,
      c.orderId,
      unknownId,
      e.orderId,
    ]);

    expect(result.results[0]).toMatchObject({
      orderId: a.orderId,
      success: true,
      replay: false,
    });
    expect(result.results[1]).toMatchObject({
      orderId: b.orderId,
      success: true,
      replay: true,
    });
    expect(result.results[2]).toMatchObject({
      orderId: c.orderId,
      success: false,
      error: { code: OrderErrorCode.INVALID_TRANSITION },
    });
    expect(result.results[3]).toMatchObject({
      orderId: unknownId,
      success: false,
      error: { code: OrderErrorCode.NOT_FOUND },
    });
    expect(result.results[4]).toMatchObject({
      orderId: e.orderId,
      success: true,
      replay: false,
    });

    expect(await orders.findById(a.orderId)).toMatchObject({
      status: OrderStatus.SHIPPED,
    });
    expect(await orders.findById(b.orderId)).toMatchObject({
      status: OrderStatus.SHIPPED,
    });
    expect(await orders.findById(c.orderId)).toMatchObject({
      status: OrderStatus.PENDING_REVIEW,
      shippedAt: null,
    });
    expect(await orders.findById(e.orderId)).toMatchObject({
      status: OrderStatus.SHIPPED,
    });

    expect(await inventory.getBalance(a.productId)).toMatchObject({
      onHand: 18,
      reserved: 0,
    });
    expect(await inventory.getBalance(e.productId)).toMatchObject({
      onHand: 18,
      reserved: 0,
    });
    expect(await inventory.getBalance(c.productId)).toMatchObject({
      onHand: 20,
      reserved: 2,
    });

    expect(
      await prisma.inventoryLedger.count({
        where: { referenceId: a.orderId, type: 'SHIP' },
      }),
    ).toBe(1);
    expect(
      await prisma.inventoryLedger.count({
        where: { referenceId: b.orderId, type: 'SHIP' },
      }),
    ).toBe(1);
    expect(
      await prisma.inventoryLedger.count({
        where: { referenceId: c.orderId, type: 'SHIP' },
      }),
    ).toBe(0);
    expect(
      await prisma.inventoryLedger.count({
        where: { referenceId: e.orderId, type: 'SHIP' },
      }),
    ).toBe(1);

    expect(
      await prisma.auditLog.count({
        where: { entityId: a.orderId, action: AuditAction.ORDER_SHIPPED },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { entityId: b.orderId, action: AuditAction.ORDER_SHIPPED },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { entityId: c.orderId, action: AuditAction.ORDER_SHIPPED },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { entityId: e.orderId, action: AuditAction.ORDER_SHIPPED },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: { contains: 'bulk' } },
      }),
    ).toBe(0);
  });

  it('bulk DELIVER sets deliveredAt and writes per-order AuditLog without Inventory mutation', async () => {
    const first = await seedShipped();
    const second = await seedShipped();
    const beforeFirst = await inventory.getBalance(first.productId);
    const beforeSecond = await inventory.getBalance(second.productId);

    const result = await bulk.execute({
      action: BulkOrderTransitionAction.DELIVER,
      orderIds: [first.orderId, second.orderId],
      actor: admin,
    });

    expect(result.summary).toEqual({ requested: 2, succeeded: 2, failed: 0 });
    const deliveredFirst = await orders.findById(first.orderId);
    const deliveredSecond = await orders.findById(second.orderId);
    expect(deliveredFirst).toMatchObject({ status: OrderStatus.DELIVERED });
    expect(deliveredSecond).toMatchObject({ status: OrderStatus.DELIVERED });
    expect(deliveredFirst!.deliveredAt).toBeInstanceOf(Date);
    expect(deliveredSecond!.deliveredAt).toBeInstanceOf(Date);

    expect(await inventory.getBalance(first.productId)).toEqual(beforeFirst);
    expect(await inventory.getBalance(second.productId)).toEqual(beforeSecond);
    expect(
      await prisma.inventoryLedger.count({
        where: {
          referenceId: { in: [first.orderId, second.orderId] },
          type: 'SHIP',
        },
      }),
    ).toBe(2);
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: { in: [first.orderId, second.orderId] },
          action: AuditAction.ORDER_DELIVERED,
        },
      }),
    ).toBe(2);
  });

  it('overlapping concurrent bulk SHIP requests share legal finals without duplicate effects', async () => {
    const o1 = await seedConfirmed();
    const o2 = await seedConfirmed();
    const o3 = await seedConfirmed();
    const o4 = await seedConfirmed();

    const [batchA, batchB] = await Promise.all([
      bulk.execute({
        action: BulkOrderTransitionAction.SHIP,
        orderIds: [o1.orderId, o2.orderId, o3.orderId],
        actor: admin,
      }),
      bulk.execute({
        action: BulkOrderTransitionAction.SHIP,
        orderIds: [o2.orderId, o3.orderId, o4.orderId],
        actor: admin,
      }),
    ]);

    const shared = [o2.orderId, o3.orderId];
    const allIds = [o1.orderId, o2.orderId, o3.orderId, o4.orderId];
    for (const orderId of allIds) {
      expect(await orders.findById(orderId)).toMatchObject({
        status: OrderStatus.SHIPPED,
      });
      expect(
        await prisma.inventoryLedger.count({
          where: { referenceId: orderId, type: 'SHIP' },
        }),
      ).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: { entityId: orderId, action: AuditAction.ORDER_SHIPPED },
        }),
      ).toBe(1);
    }

    const combined = [...batchA.results, ...batchB.results];
    for (const orderId of shared) {
      const outcomes = combined.filter((item) => item.orderId === orderId);
      expect(outcomes).toHaveLength(2);
      expect(outcomes.every((item) => item.success)).toBe(true);
      expect(outcomes.some((item) => item.success && item.replay)).toBe(true);
      expect(outcomes.some((item) => item.success && !item.replay)).toBe(true);
    }

    expect(batchA.summary.requested).toBe(3);
    expect(batchB.summary.requested).toBe(3);
    expect(batchA.summary.failed + batchB.summary.failed).toBe(0);
    expect(batchA.summary.succeeded + batchB.summary.succeeded).toBe(6);
  });

  it('single-order SHIP racing bulk SHIP yields one inventory and audit effect', async () => {
    const target = await seedConfirmed();

    const [single, batch] = await Promise.all([
      transitions.shipOrder({ orderId: target.orderId, actor: admin }),
      bulk.execute({
        action: BulkOrderTransitionAction.SHIP,
        orderIds: [target.orderId],
        actor: admin,
      }),
    ]);

    expect(await orders.findById(target.orderId)).toMatchObject({
      status: OrderStatus.SHIPPED,
    });
    expect(await inventory.getBalance(target.productId)).toMatchObject({
      onHand: 18,
      reserved: 0,
    });
    expect(
      await prisma.inventoryLedger.count({
        where: { referenceId: target.orderId, type: 'SHIP' },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: target.orderId,
          action: AuditAction.ORDER_SHIPPED,
        },
      }),
    ).toBe(1);

    expect(single.order.status).toBe(OrderStatus.SHIPPED);
    expect(batch.results).toHaveLength(1);
    expect(batch.results[0]).toMatchObject({
      orderId: target.orderId,
      success: true,
    });
    const replays = [
      single.replay,
      batch.results[0]!.success && batch.results[0]!.replay,
    ];
    expect(replays.filter(Boolean).length).toBe(1);
    expect(replays.filter((value) => !value).length).toBe(1);
  });
});

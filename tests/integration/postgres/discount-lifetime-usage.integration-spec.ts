import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdminRole } from '../../../src/common/authz/admin-role';
import { postgresIntegrationImports } from '../support/postgres-testing-module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { TransactionRunner } from '../../../src/infrastructure/database/transaction';
import { CategoryRepository } from '../../../src/modules/categories/infrastructure/category.repository';
import { CommercePolicyService } from '../../../src/modules/commerce-policy/application/commerce-policy.service';
import { CommercePolicyModule } from '../../../src/modules/commerce-policy/commerce-policy.module';
import {
  InventoryService,
  SYSTEM_ACTOR,
} from '../../../src/modules/inventory/application/inventory.service';
import { InventoryInsufficientStockError } from '../../../src/modules/inventory/domain/inventory-errors';
import {
  InventoryLedgerReferenceType,
  InventoryLedgerType,
} from '../../../src/modules/inventory/domain/inventory-ledger';
import { InventoryModule } from '../../../src/modules/inventory/inventory.module';
import { OrderCreationService } from '../../../src/modules/orders/application/order-creation.service';
import type { CreateOrderResult } from '../../../src/modules/orders/application/order-creation.commands';
import type { OrderTransitionResult } from '../../../src/modules/orders/application/order-transition.commands';
import { OrderTransitionService } from '../../../src/modules/orders/application/order-transition.service';
import { OrderReturnService } from '../../../src/modules/orders/application/order-return.service';
import { OrderRepository } from '../../../src/modules/orders/infrastructure/order.repository';
import { OrderActorType } from '../../../src/modules/orders/domain/order-actor';
import {
  OrderInvalidInputError,
  OrderInvalidTransitionError,
} from '../../../src/modules/orders/domain/order-errors';
import { OrderStatus } from '../../../src/modules/orders/domain/order-status';
import { OrdersModule } from '../../../src/modules/orders/orders.module';
import { DiscountService } from '../../../src/modules/pricing/application/discount.service';
import { DiscountUsageService } from '../../../src/modules/pricing/application/discount-usage.service';
import {
  DiscountTarget,
  DiscountType,
  type DiscountRecord,
} from '../../../src/modules/pricing/domain/discount';
import { DiscountInvalidTargetError } from '../../../src/modules/pricing/domain/discount-errors';
import { DiscountUsageRecordKind } from '../../../src/modules/pricing/domain/discount-usage';
import { DiscountUsageRepository } from '../../../src/modules/pricing/infrastructure/discount-usage.repository';
import { PricingModule } from '../../../src/modules/pricing/pricing.module';
import { ProductRepository } from '../../../src/modules/products/infrastructure/product.repository';
import { ProductsModule } from '../../../src/modules/products/products.module';
import { RegionRepository } from '../../../src/modules/regions/infrastructure/region.repository';
import type { UserRecord } from '../../../src/modules/users/domain/user';
import { UserRepository } from '../../../src/modules/users/infrastructure/user.repository';
import { UsersModule } from '../../../src/modules/users/users.module';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';
import { ConcurrencyGate } from '../support/concurrency-gate';
import { AuditAction } from '../../../src/modules/audit/domain/audit-event';

function uniquePhone(suffix: number): string {
  const national = `912${String(suffix).padStart(7, '0')}`.slice(0, 10);
  return `+98${national}`;
}

async function truncateTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "DiscountUsageRecord", "DiscountCustomerUsage", "InventoryLedger", "InventoryReservation", "Inventory", "Discount", "PriceHistory", "OrderReturnLine", "OrderReturn", "OrderLine", "Order", "Product", "Category", "Region", "User", "CommerceScheduleOverride", "CommerceSettings" RESTART IDENTITY CASCADE',
  );
}

describe('Discount lifetime usage (DLU-02 integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let users: UserRepository;
  let regions: RegionRepository;
  let categories: CategoryRepository;
  let products: ProductRepository;
  let inventory: InventoryService;
  let discounts: DiscountService;
  let discountUsage: DiscountUsageService;
  let usageRepo: DiscountUsageRepository;
  let creation: OrderCreationService;
  let transitions: OrderTransitionService;
  let returns: OrderReturnService;
  let orders: OrderRepository;
  let commercePolicy: CommercePolicyService;
  let transactions: TransactionRunner;
  let phoneCounter = 0;
  let adminActorId: string;

  const admin = {
    type: OrderActorType.ADMIN,
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  } as const;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ...postgresIntegrationImports([
          InventoryModule,
          ProductsModule,
          PricingModule,
          UsersModule,
          OrdersModule,
          CommercePolicyModule,
        ]),
      ],
      providers: [CategoryRepository, RegionRepository],
    }).compile();

    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    users = moduleRef.get(UserRepository);
    regions = moduleRef.get(RegionRepository);
    categories = moduleRef.get(CategoryRepository);
    products = moduleRef.get(ProductRepository);
    inventory = moduleRef.get(InventoryService);
    discounts = moduleRef.get(DiscountService);
    discountUsage = moduleRef.get(DiscountUsageService);
    usageRepo = moduleRef.get(DiscountUsageRepository);
    creation = moduleRef.get(OrderCreationService);
    transitions = moduleRef.get(OrderTransitionService);
    returns = moduleRef.get(OrderReturnService);
    orders = moduleRef.get(OrderRepository);
    commercePolicy = moduleRef.get(CommercePolicyService);
    transactions = moduleRef.get(TransactionRunner);
    await app.init();
  });

  beforeEach(async () => {
    await truncateTables(prisma);
    const adminRow = await prisma.admin.upsert({
      where: { email: 'dlu-02-integration@example.test' },
      update: { isActive: true, role: AdminRole.SUPER_ADMIN },
      create: {
        email: 'dlu-02-integration@example.test',
        passwordHash: 'integration-placeholder-hash',
        role: AdminRole.SUPER_ADMIN,
      },
    });
    adminActorId = adminRow.id;
    await commercePolicy.initialize(
      {
        orderingScheduleEnabled: false,
        orderingOpensAtLocalMinute: 7 * 60,
        orderingClosesAtLocalMinute: 16 * 60,
        minimumOrderQuantity: 1,
      },
      0,
      adminActorId,
    );
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  function nextPhone(): string {
    phoneCounter += 1;
    return uniquePhone(phoneCounter + (Date.now() % 1_000_000));
  }

  async function seedBase(options?: {
    price?: number;
    onHand?: number;
    maxQuantityPerCustomer?: number;
    percentValue?: number;
  }): Promise<{
    user: UserRecord;
    regionId: string;
    productId: string;
    categoryId: string;
    discount: DiscountRecord;
  }> {
    const user = await users.create({ phone: nextPhone() });
    const region = await regions.create({ name: `Region ${randomUUID()}` });
    const category = await categories.create({ name: `Cat ${randomUUID()}` });
    const product = await products.create({
      name: `Eggs ${randomUUID()}`,
      price: options?.price ?? 10_000,
      categoryId: category.id,
    });
    await inventory.ensureForProduct(product.id);
    const onHand = options?.onHand ?? 100;
    if (onHand > 0) {
      await inventory.receiveOnHand({
        productId: product.id,
        quantity: onHand,
        referenceType: InventoryLedgerReferenceType.RECEIVE,
        referenceId: randomUUID(),
        actor: SYSTEM_ACTOR,
      });
    }
    const discount = await discounts.create({
      name: `Capped PRODUCT ${randomUUID()}`,
      type: DiscountType.PERCENT,
      target: DiscountTarget.PRODUCT,
      percentValue: options?.percentValue ?? 20,
      productId: product.id,
      precedence: 10,
      maxQuantityPerCustomer: options?.maxQuantityPerCustomer ?? 3,
    });
    return {
      user,
      regionId: region.id,
      productId: product.id,
      categoryId: category.id,
      discount,
    };
  }

  async function createOrder(input: {
    userId: string;
    regionId: string;
    productId: string;
    quantity: number;
    idempotencyKey?: string;
  }): Promise<CreateOrderResult> {
    return creation.createOrder({
      actor: { type: OrderActorType.USER, id: input.userId },
      regionId: input.regionId,
      idempotencyKey: input.idempotencyKey ?? randomUUID(),
      lines: [{ productId: input.productId, quantity: input.quantity }],
    });
  }

  it('first eligible purchase consumes usage correctly', async () => {
    const { user, regionId, productId, discount } = await seedBase({
      maxQuantityPerCustomer: 5,
      percentValue: 10,
    });

    const result = await createOrder({
      userId: user.id,
      regionId,
      productId,
      quantity: 2,
    });

    expect(result.created).toBe(true);
    expect(result.order.lines[0]!.discountedQuantity).toBe(2);
    expect(result.order.lines[0]!.appliedLineDiscount?.discountId).toBe(
      discount.id,
    );

    const usage = await usageRepo.findUsage(discount.id, user.id);
    expect(usage?.consumedQuantity).toBe(2);

    const records = await usageRepo.listRecordsForOrder(result.order.id);
    expect(records).toEqual([
      expect.objectContaining({
        discountId: discount.id,
        userId: user.id,
        kind: DiscountUsageRecordKind.CONSUME,
        quantity: 2,
      }),
    ]);
  });

  it('partial discount at remaining-cap boundary (ADR 0017 example)', async () => {
    // unit 100_000, qty 5, remaining 3, 20% 뿯↽ gross 500_000, discount 60_000, final 440_000
    const { user, regionId, productId, discount } = await seedBase({
      price: 100_000,
      maxQuantityPerCustomer: 3,
      percentValue: 20,
    });

    const result = await createOrder({
      userId: user.id,
      regionId,
      productId,
      quantity: 5,
    });

    expect(result.created).toBe(true);
    const line = result.order.lines[0]!;
    expect(line.discountedQuantity).toBe(3);
    expect(line.grossLineTotal).toBe(500_000n);
    expect(line.lineDiscountAmount).toBe(60_000n);
    expect(line.finalLineTotal).toBe(440_000n);
    expect(result.order.grossSubtotal).toBe(500_000n);
    expect(result.order.total).toBe(440_000n);

    const usage = await usageRepo.findUsage(discount.id, user.id);
    expect(usage?.consumedQuantity).toBe(3);
  });

  it('exhausted cap gives no further PRODUCT discount on next order', async () => {
    const { user, regionId, productId, discount, categoryId } = await seedBase({
      maxQuantityPerCustomer: 2,
      percentValue: 20,
    });

    const first = await createOrder({
      userId: user.id,
      regionId,
      productId,
      quantity: 2,
    });
    expect(first.order.lines[0]!.discountedQuantity).toBe(2);
    expect(await usageRepo.findUsage(discount.id, user.id)).toMatchObject({
      consumedQuantity: 2,
    });

    const second = await createOrder({
      userId: user.id,
      regionId,
      productId,
      quantity: 1,
    });
    expect(second.order.lines[0]!.appliedLineDiscount).toBeNull();
    expect(second.order.lines[0]!.discountedQuantity).toBe(0);
    expect(second.order.lines[0]!.lineDiscountAmount).toBe(0n);
    expect(await usageRepo.findUsage(discount.id, user.id)).toMatchObject({
      consumedQuantity: 2,
    });
    expect(await usageRepo.listRecordsForOrder(second.order.id)).toEqual([]);

    // CATEGORY may still win once PRODUCT is exhausted.
    const categoryDiscount = await discounts.create({
      name: `Category fallback ${randomUUID()}`,
      type: DiscountType.PERCENT,
      target: DiscountTarget.CATEGORY,
      percentValue: 5,
      categoryId,
      precedence: 1,
    });
    const withCategory = await createOrder({
      userId: user.id,
      regionId,
      productId,
      quantity: 1,
    });
    expect(withCategory.order.lines[0]!.appliedLineDiscount?.discountId).toBe(
      categoryDiscount.id,
    );
    expect(withCategory.order.lines[0]!.discountedQuantity).toBe(1);
    // CATEGORY winners must not consume PRODUCT lifetime usage.
    expect(await usageRepo.findUsage(discount.id, user.id)).toMatchObject({
      consumedQuantity: 2,
    });
    expect(await usageRepo.listRecordsForOrder(withCategory.order.id)).toEqual(
      [],
    );
  });

  it('same Order idempotency replay does not consume twice', async () => {
    const { user, regionId, productId, discount } = await seedBase({
      maxQuantityPerCustomer: 5,
    });
    const idempotencyKey = randomUUID();

    const first = await createOrder({
      userId: user.id,
      regionId,
      productId,
      quantity: 2,
      idempotencyKey,
    });
    expect(first.created).toBe(true);

    const replay = await createOrder({
      userId: user.id,
      regionId,
      productId,
      quantity: 2,
      idempotencyKey,
    });
    expect(replay.created).toBe(false);
    expect(replay.order.id).toBe(first.order.id);

    expect(await usageRepo.findUsage(discount.id, user.id)).toMatchObject({
      consumedQuantity: 2,
    });
    const records = await usageRepo.listRecordsForOrder(first.order.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: DiscountUsageRecordKind.CONSUME,
      quantity: 2,
    });
  });

  it('pre-SHIPPED cancel releases usage exactly once', async () => {
    const { user, regionId, productId, discount } = await seedBase({
      maxQuantityPerCustomer: 5,
    });

    const created = await createOrder({
      userId: user.id,
      regionId,
      productId,
      quantity: 2,
    });
    expect(await usageRepo.findUsage(discount.id, user.id)).toMatchObject({
      consumedQuantity: 2,
    });

    const cancelled = await transitions.cancelPendingOrderByCustomer({
      orderId: created.order.id,
      actor: { type: OrderActorType.USER, id: user.id },
    });
    expect(cancelled.replay).toBe(false);
    expect(cancelled.order.status).toBe(OrderStatus.CANCELLED);

    expect(await usageRepo.findUsage(discount.id, user.id)).toMatchObject({
      consumedQuantity: 0,
    });
    const records = await usageRepo.listRecordsForOrder(created.order.id);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: DiscountUsageRecordKind.CONSUME,
          quantity: 2,
        }),
        expect.objectContaining({
          kind: DiscountUsageRecordKind.RELEASE,
          quantity: 2,
        }),
      ]),
    );
    expect(records).toHaveLength(2);
  });

  it('cancel replay does not release twice', async () => {
    const { user, regionId, productId, discount } = await seedBase({
      maxQuantityPerCustomer: 5,
    });

    const created = await createOrder({
      userId: user.id,
      regionId,
      productId,
      quantity: 3,
    });

    await transitions.cancelPendingOrderByCustomer({
      orderId: created.order.id,
      actor: { type: OrderActorType.USER, id: user.id },
    });
    const replay = await transitions.cancelPendingOrderByCustomer({
      orderId: created.order.id,
      actor: { type: OrderActorType.USER, id: user.id },
    });
    expect(replay.replay).toBe(true);

    expect(await usageRepo.findUsage(discount.id, user.id)).toMatchObject({
      consumedQuantity: 0,
    });
    const releases = (
      await usageRepo.listRecordsForOrder(created.order.id)
    ).filter((row) => row.kind === DiscountUsageRecordKind.RELEASE);
    expect(releases).toHaveLength(1);
  });

  it('concurrent cancellation releases capped DLU, Inventory, and AuditLog exactly once', async () => {
    const { user, regionId, productId, discount } = await seedBase({
      maxQuantityPerCustomer: 5,
      onHand: 10,
    });
    const created = await createOrder({
      userId: user.id,
      regionId,
      productId,
      quantity: 2,
    });
    const gate = new ConcurrencyGate(12);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 12 }, async () => {
        await gate.arriveAndWait();
        return transitions.cancelPendingOrderByCustomer({
          orderId: created.order.id,
          actor: { type: OrderActorType.USER, id: user.id },
        });
      }),
    );

    const fulfilled = outcomes.filter((row) => row.status === 'fulfilled');
    expect(fulfilled).toHaveLength(12);
    expect(fulfilled.filter((row) => row.value.replay === false)).toHaveLength(
      1,
    );
    expect(fulfilled.filter((row) => row.value.replay === true)).toHaveLength(
      11,
    );

    expect(
      await prisma.order.findUnique({ where: { id: created.order.id } }),
    ).toMatchObject({
      status: OrderStatus.CANCELLED,
    });
    expect(
      await prisma.inventoryReservation.findMany({
        where: { orderId: created.order.id },
      }),
    ).toEqual([expect.objectContaining({ status: 'RELEASED', quantity: 2 })]);
    expect(await inventory.getBalance(productId)).toMatchObject({
      onHand: 10,
      reserved: 0,
      available: 10,
    });
    expect(
      await prisma.inventoryLedger.count({
        where: { referenceId: created.order.id, type: 'RELEASE' },
      }),
    ).toBe(1);
    expect(await usageRepo.findUsage(discount.id, user.id)).toMatchObject({
      consumedQuantity: 0,
    });
    expect(
      (await usageRepo.listRecordsForOrder(created.order.id)).filter(
        (row) => row.kind === DiscountUsageRecordKind.RELEASE,
      ),
    ).toHaveLength(1);
    expect(
      await prisma.auditLog.count({
        where: {
          action: AuditAction.ORDER_CANCELLED,
          entityId: created.order.id,
        },
      }),
    ).toBe(1);
  }, 30_000);

  it('cancel XOR confirm with capped DLU leaves the winner state mathematically consistent', async () => {
    const { user, regionId, productId, discount } = await seedBase({
      maxQuantityPerCustomer: 5,
      onHand: 10,
    });
    const created = await createOrder({
      userId: user.id,
      regionId,
      productId,
      quantity: 2,
    });
    const gate = new ConcurrencyGate(2);
    const outcomes = await Promise.allSettled([
      (async (): Promise<OrderTransitionResult> => {
        await gate.arriveAndWait();
        return transitions.confirmOrder({
          orderId: created.order.id,
          actor: admin,
        });
      })(),
      (async (): Promise<OrderTransitionResult> => {
        await gate.arriveAndWait();
        return transitions.cancelPendingOrderByCustomer({
          orderId: created.order.id,
          actor: { type: OrderActorType.USER, id: user.id },
        });
      })(),
    ]);
    const final = await prisma.order.findUnique({
      where: { id: created.order.id },
    });
    expect(
      final?.status === OrderStatus.CONFIRMED ||
        final?.status === OrderStatus.CANCELLED,
    ).toBe(true);

    const reservation = await prisma.inventoryReservation.findUnique({
      where: { orderId_productId: { orderId: created.order.id, productId } },
    });
    const usage = await usageRepo.findUsage(discount.id, user.id);
    const cancelAuditCount = await prisma.auditLog.count({
      where: {
        action: AuditAction.ORDER_CANCELLED,
        entityId: created.order.id,
      },
    });
    const confirmAuditCount = await prisma.auditLog.count({
      where: {
        action: AuditAction.ORDER_CONFIRMED,
        entityId: created.order.id,
      },
    });
    expect(outcomes.filter((row) => row.status === 'fulfilled')).toHaveLength(
      1,
    );
    if (final?.status === OrderStatus.CANCELLED) {
      expect(reservation?.status).toBe('RELEASED');
      expect(usage?.consumedQuantity).toBe(0);
      expect(cancelAuditCount).toBe(1);
      expect(confirmAuditCount).toBe(0);
    } else {
      expect(reservation?.status).toBe('ACTIVE');
      expect(usage?.consumedQuantity).toBe(2);
      expect(cancelAuditCount).toBe(0);
      expect(confirmAuditCount).toBe(1);
    }
  }, 30_000);

  it('after ship, usage remains consumed and cancel is invalid', async () => {
    const { user, regionId, productId, discount } = await seedBase({
      maxQuantityPerCustomer: 5,
    });

    const created = await createOrder({
      userId: user.id,
      regionId,
      productId,
      quantity: 2,
    });

    await transitions.confirmOrder({
      orderId: created.order.id,
      actor: admin,
    });
    await transitions.shipOrder({
      orderId: created.order.id,
      actor: admin,
    });

    expect(await usageRepo.findUsage(discount.id, user.id)).toMatchObject({
      consumedQuantity: 2,
    });

    await expect(
      transitions.cancelOrderByAdmin({
        orderId: created.order.id,
        actor: admin,
        cancelReason: 'should not restore entitlement',
      }),
    ).rejects.toBeInstanceOf(OrderInvalidTransitionError);

    expect(await usageRepo.findUsage(discount.id, user.id)).toMatchObject({
      consumedQuantity: 2,
    });
    const records = await usageRepo.listRecordsForOrder(created.order.id);
    expect(
      records.filter((row) => row.kind === DiscountUsageRecordKind.RELEASE),
    ).toHaveLength(0);
  });

  it('ship then deliver leaves usage consumed (ORD-07 must not restore; no RETURNED in V1)', async () => {
    // DLU-02 / ADR 0017: returns must not restore lifetime entitlement.
    // Post-ship lifecycle keeps usage; ORD-07 recordReturn proof is the next case.
    const { user, regionId, productId, discount } = await seedBase({
      maxQuantityPerCustomer: 4,
    });

    const created = await createOrder({
      userId: user.id,
      regionId,
      productId,
      quantity: 2,
    });
    await transitions.confirmOrder({ orderId: created.order.id, actor: admin });
    await transitions.shipOrder({ orderId: created.order.id, actor: admin });
    const delivered = await transitions.deliverOrder({
      orderId: created.order.id,
      actor: admin,
    });
    expect(delivered.order.status).toBe(OrderStatus.DELIVERED);

    expect(await usageRepo.findUsage(discount.id, user.id)).toMatchObject({
      consumedQuantity: 2,
    });
    expect(
      (await usageRepo.listRecordsForOrder(created.order.id)).filter(
        (row) => row.kind === DiscountUsageRecordKind.RELEASE,
      ),
    ).toHaveLength(0);
  });

  it('ORD-07 sellable return after deliver does not restore DiscountCustomerUsage', async () => {
    // ADR 0017 / ADR 0024: inventory restock may occur; lifetime entitlement must not.
    const sellableQuantity = 2;
    const orderQuantity = 3;
    const { user, regionId, productId, discount } = await seedBase({
      maxQuantityPerCustomer: 5,
      onHand: 50,
    });

    const created = await createOrder({
      userId: user.id,
      regionId,
      productId,
      quantity: orderQuantity,
    });
    expect(created.created).toBe(true);
    const line = created.order.lines[0]!;
    expect(line.discountedQuantity).toBe(orderQuantity);
    expect(line.appliedLineDiscount?.discountId).toBe(discount.id);

    const usageAfterCreate = await usageRepo.findUsage(discount.id, user.id);
    expect(usageAfterCreate?.consumedQuantity).toBe(orderQuantity);
    const consumeRecords = await usageRepo.listRecordsForOrder(
      created.order.id,
    );
    expect(consumeRecords).toEqual([
      expect.objectContaining({
        discountId: discount.id,
        userId: user.id,
        kind: DiscountUsageRecordKind.CONSUME,
        quantity: orderQuantity,
      }),
    ]);

    await transitions.confirmOrder({ orderId: created.order.id, actor: admin });
    await transitions.shipOrder({ orderId: created.order.id, actor: admin });
    const delivered = await transitions.deliverOrder({
      orderId: created.order.id,
      actor: admin,
    });
    expect(delivered.order.status).toBe(OrderStatus.DELIVERED);
    expect(delivered.order.returnedAt).toBeNull();

    const usageAfterDeliver = await usageRepo.findUsage(discount.id, user.id);
    expect(usageAfterDeliver?.consumedQuantity).toBe(orderQuantity);
    expect(
      (await usageRepo.listRecordsForOrder(created.order.id)).filter(
        (row) => row.kind === DiscountUsageRecordKind.RELEASE,
      ),
    ).toHaveLength(0);

    const balanceBeforeReturn = await inventory.getBalance(productId);
    const totalBeforeReturn = delivered.order.total;
    const discountedQuantityBeforeReturn = line.discountedQuantity;

    const recorded = await returns.recordReturn({
      orderId: created.order.id,
      idempotencyKey: randomUUID(),
      reason: 'sellable DLU non-interaction proof',
      lines: [
        {
          orderLineId: line.id,
          sellableQuantity,
          damagedQuantity: 0,
        },
      ],
      actor: { type: OrderActorType.ADMIN, id: adminActorId },
    });

    expect(recorded.replay).toBe(false);
    expect(recorded.orderReturn.orderId).toBe(created.order.id);
    expect(recorded.orderReturn.lines).toEqual([
      expect.objectContaining({
        orderLineId: line.id,
        sellableQuantity,
        damagedQuantity: 0,
      }),
    ]);

    const usageAfterReturn = await usageRepo.findUsage(discount.id, user.id);
    expect(usageAfterReturn?.consumedQuantity).toBe(orderQuantity);
    expect(usageAfterReturn?.consumedQuantity).toBe(
      usageAfterDeliver?.consumedQuantity,
    );

    const recordsAfterReturn = await usageRepo.listRecordsForOrder(
      created.order.id,
    );
    expect(recordsAfterReturn).toHaveLength(1);
    expect(recordsAfterReturn[0]).toMatchObject({
      kind: DiscountUsageRecordKind.CONSUME,
      quantity: orderQuantity,
    });
    expect(
      recordsAfterReturn.filter(
        (row) => row.kind === DiscountUsageRecordKind.RELEASE,
      ),
    ).toHaveLength(0);

    const balanceAfterReturn = await inventory.getBalance(productId);
    expect(balanceBeforeReturn).not.toBeNull();
    expect(balanceAfterReturn).not.toBeNull();
    expect(balanceAfterReturn!.onHand).toBe(
      balanceBeforeReturn!.onHand + sellableQuantity,
    );
    const returnLedgers = await prisma.inventoryLedger.findMany({
      where: {
        type: InventoryLedgerType.RETURN_TO_STOCK,
        referenceId: recorded.orderReturn.id,
      },
    });
    expect(returnLedgers).toHaveLength(1);
    expect(returnLedgers[0]).toMatchObject({
      referenceType: InventoryLedgerReferenceType.RETURN,
      quantity: sellableQuantity,
      onHandDelta: sellableQuantity,
      reservedDelta: 0,
    });

    const orderAfterReturn = await orders.findById(created.order.id);
    expect(orderAfterReturn).toMatchObject({
      status: OrderStatus.DELIVERED,
      returnedAt: null,
      total: totalBeforeReturn,
    });
    expect(orderAfterReturn?.lines[0]?.discountedQuantity).toBe(
      discountedQuantityBeforeReturn,
    );
  });

  it('concurrent same-user/same-discount Orders never exceed the cap', async () => {
    const { user, regionId, productId, discount } = await seedBase({
      maxQuantityPerCustomer: 3,
      onHand: 200,
    });

    const settled = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        createOrder({
          userId: user.id,
          regionId,
          productId,
          quantity: 2,
        }),
      ),
    );

    const fulfilled = settled.filter((row) => row.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThan(0);

    const discountedSum = fulfilled.reduce((sum, row) => {
      if (row.status !== 'fulfilled') {
        return sum;
      }
      return sum + row.value.order.lines[0]!.discountedQuantity;
    }, 0);
    expect(discountedSum).toBeLessThanOrEqual(3);

    const usage = await usageRepo.findUsage(discount.id, user.id);
    expect(usage?.consumedQuantity ?? 0).toBeLessThanOrEqual(3);
    expect(usage?.consumedQuantity ?? 0).toBe(discountedSum);

    const consumeRows = await prisma.$queryRaw<Array<{ quantity: number }>>`
      SELECT quantity
      FROM "DiscountUsageRecord"
      WHERE "discountId" = ${discount.id}::uuid
        AND "userId" = ${user.id}::uuid
        AND kind = ${DiscountUsageRecordKind.CONSUME}::"DiscountUsageRecordKind"
    `;
    const recordSum = consumeRows.reduce((sum, row) => sum + row.quantity, 0);
    expect(recordSum).toBe(usage?.consumedQuantity ?? 0);
  }, 60_000);

  it('concurrent orders with remaining smaller than combined demand divide safely', async () => {
    const { user, regionId, productId, discount } = await seedBase({
      maxQuantityPerCustomer: 5,
      onHand: 200,
    });

    // Pre-consume 3 so remaining = 2; two parallel qty=2 creates must not exceed 5 total.
    const prior = await createOrder({
      userId: user.id,
      regionId,
      productId,
      quantity: 3,
    });
    expect(prior.order.lines[0]!.discountedQuantity).toBe(3);

    const settled = await Promise.allSettled([
      createOrder({ userId: user.id, regionId, productId, quantity: 2 }),
      createOrder({ userId: user.id, regionId, productId, quantity: 2 }),
    ]);

    const fulfilled = settled.filter((row) => row.status === 'fulfilled');
    expect(fulfilled).toHaveLength(2);

    const extraDiscounted = fulfilled.reduce((sum, row) => {
      if (row.status !== 'fulfilled') {
        return sum;
      }
      return sum + row.value.order.lines[0]!.discountedQuantity;
    }, 0);
    expect(extraDiscounted).toBe(2);

    expect(await usageRepo.findUsage(discount.id, user.id)).toMatchObject({
      consumedQuantity: 5,
    });
  }, 30_000);

  it('different users have independent caps', async () => {
    const { user, regionId, productId, discount } = await seedBase({
      maxQuantityPerCustomer: 2,
      onHand: 50,
    });
    const other = await users.create({ phone: nextPhone() });

    const a = await createOrder({
      userId: user.id,
      regionId,
      productId,
      quantity: 2,
    });
    const b = await createOrder({
      userId: other.id,
      regionId,
      productId,
      quantity: 2,
    });

    expect(a.order.lines[0]!.discountedQuantity).toBe(2);
    expect(b.order.lines[0]!.discountedQuantity).toBe(2);
    expect(await usageRepo.findUsage(discount.id, user.id)).toMatchObject({
      consumedQuantity: 2,
    });
    expect(await usageRepo.findUsage(discount.id, other.id)).toMatchObject({
      consumedQuantity: 2,
    });
  });

  it('different discounts have independent usage', async () => {
    const user = await users.create({ phone: nextPhone() });
    const region = await regions.create({ name: `Region ${randomUUID()}` });
    const category = await categories.create({ name: `Cat ${randomUUID()}` });
    const productA = await products.create({
      name: `SKU-A ${randomUUID()}`,
      price: 10_000,
      categoryId: category.id,
    });
    const productB = await products.create({
      name: `SKU-B ${randomUUID()}`,
      price: 10_000,
      categoryId: category.id,
    });
    for (const productId of [productA.id, productB.id]) {
      await inventory.ensureForProduct(productId);
      await inventory.receiveOnHand({
        productId,
        quantity: 50,
        referenceType: InventoryLedgerReferenceType.RECEIVE,
        referenceId: randomUUID(),
        actor: SYSTEM_ACTOR,
      });
    }
    const discountA = await discounts.create({
      name: `Cap A ${randomUUID()}`,
      type: DiscountType.PERCENT,
      target: DiscountTarget.PRODUCT,
      percentValue: 10,
      productId: productA.id,
      precedence: 10,
      maxQuantityPerCustomer: 2,
    });
    const discountB = await discounts.create({
      name: `Cap B ${randomUUID()}`,
      type: DiscountType.PERCENT,
      target: DiscountTarget.PRODUCT,
      percentValue: 10,
      productId: productB.id,
      precedence: 10,
      maxQuantityPerCustomer: 3,
    });

    await creation.createOrder({
      actor: { type: OrderActorType.USER, id: user.id },
      regionId: region.id,
      idempotencyKey: randomUUID(),
      lines: [{ productId: productA.id, quantity: 2 }],
    });
    await creation.createOrder({
      actor: { type: OrderActorType.USER, id: user.id },
      regionId: region.id,
      idempotencyKey: randomUUID(),
      lines: [{ productId: productB.id, quantity: 3 }],
    });

    expect(await usageRepo.findUsage(discountA.id, user.id)).toMatchObject({
      consumedQuantity: 2,
    });
    expect(await usageRepo.findUsage(discountB.id, user.id)).toMatchObject({
      consumedQuantity: 3,
    });
  });

  it('failed Order creation / Inventory reservation leaves no consumed usage', async () => {
    const { user, regionId, productId, discount } = await seedBase({
      maxQuantityPerCustomer: 5,
      onHand: 1,
      percentValue: 10,
    });

    await expect(
      createOrder({
        userId: user.id,
        regionId,
        productId,
        quantity: 5,
      }),
    ).rejects.toBeInstanceOf(InventoryInsufficientStockError);

    expect(await prisma.order.count()).toBe(0);
    expect(await usageRepo.findUsage(discount.id, user.id)).toBeNull();
    const records = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "DiscountUsageRecord"
      WHERE "discountId" = ${discount.id}::uuid
        AND "userId" = ${user.id}::uuid
    `;
    expect(records).toHaveLength(0);
  });

  it('outer transaction rollback leaves no usage residue', async () => {
    const { user, discount } = await seedBase({
      maxQuantityPerCustomer: 5,
    });

    await expect(
      transactions.runRepeatableRead(async (tx) => {
        await discountUsage.lockRemainingForPricing(
          { userId: user.id, discounts: [discount] },
          tx,
        );
        await discountUsage.consumeForOrder(
          {
            orderId: randomUUID(),
            userId: user.id,
            consumptions: [{ discountId: discount.id, quantity: 2 }],
          },
          tx,
        );
        throw new Error('force usage rollback');
      }),
    ).rejects.toThrow('force usage rollback');

    expect(await usageRepo.findUsage(discount.id, user.id)).toBeNull();
    const records = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "DiscountUsageRecord"
      WHERE "discountId" = ${discount.id}::uuid
        AND "userId" = ${user.id}::uuid
    `;
    expect(records).toHaveLength(0);
  });

  it('usage records and OrderLine.discountedQuantity agree with committed pricing', async () => {
    const { user, regionId, productId, discount } = await seedBase({
      price: 100_000,
      maxQuantityPerCustomer: 3,
      percentValue: 20,
    });

    const result = await createOrder({
      userId: user.id,
      regionId,
      productId,
      quantity: 5,
    });

    const line = result.order.lines[0]!;
    expect(line.discountedQuantity).toBe(3);
    expect(line.lineDiscountAmount).toBe(60_000n);
    expect(line.finalLineTotal).toBe(440_000n);

    const usage = await usageRepo.findUsage(discount.id, user.id);
    expect(usage?.consumedQuantity).toBe(line.discountedQuantity);

    const records = await usageRepo.listRecordsForOrder(result.order.id);
    expect(records).toEqual([
      expect.objectContaining({
        kind: DiscountUsageRecordKind.CONSUME,
        quantity: line.discountedQuantity,
        discountId: discount.id,
      }),
    ]);

    const persisted = await prisma.orderLine.findFirst({
      where: { orderId: result.order.id },
    });
    expect(persisted?.discountedQuantity).toBe(3);
    expect(persisted?.lineDiscountAmount).toBe(60_000n);
    expect(persisted?.finalLineTotal).toBe(440_000n);
  });

  it('multi-discount multi-SKU concurrent orders complete without deadlock', async () => {
    const userA = await users.create({ phone: nextPhone() });
    const userB = await users.create({ phone: nextPhone() });
    const region = await regions.create({ name: `Region ${randomUUID()}` });
    const category = await categories.create({ name: `Cat ${randomUUID()}` });
    const productA = await products.create({
      name: `SKU-A ${randomUUID()}`,
      price: 8_000,
      categoryId: category.id,
    });
    const productB = await products.create({
      name: `SKU-B ${randomUUID()}`,
      price: 9_000,
      categoryId: category.id,
    });
    for (const productId of [productA.id, productB.id]) {
      await inventory.ensureForProduct(productId);
      await inventory.receiveOnHand({
        productId,
        quantity: 200,
        referenceType: InventoryLedgerReferenceType.RECEIVE,
        referenceId: randomUUID(),
        actor: SYSTEM_ACTOR,
      });
    }
    const discountA = await discounts.create({
      name: `Cap A ${randomUUID()}`,
      type: DiscountType.PERCENT,
      target: DiscountTarget.PRODUCT,
      percentValue: 10,
      productId: productA.id,
      precedence: 10,
      maxQuantityPerCustomer: 10,
    });
    const discountB = await discounts.create({
      name: `Cap B ${randomUUID()}`,
      type: DiscountType.PERCENT,
      target: DiscountTarget.PRODUCT,
      percentValue: 10,
      productId: productB.id,
      precedence: 10,
      maxQuantityPerCustomer: 10,
    });

    // Opposite lock acquisition order across users would deadlock without sorted discountId locking.
    const settled = await Promise.allSettled([
      ...Array.from({ length: 8 }, () =>
        creation.createOrder({
          actor: { type: OrderActorType.USER, id: userA.id },
          regionId: region.id,
          idempotencyKey: randomUUID(),
          lines: [
            { productId: productA.id, quantity: 1 },
            { productId: productB.id, quantity: 1 },
          ],
        }),
      ),
      ...Array.from({ length: 8 }, () =>
        creation.createOrder({
          actor: { type: OrderActorType.USER, id: userB.id },
          regionId: region.id,
          idempotencyKey: randomUUID(),
          lines: [
            { productId: productB.id, quantity: 1 },
            { productId: productA.id, quantity: 1 },
          ],
        }),
      ),
    ]);

    const fulfilled = settled.filter((row) => row.status === 'fulfilled');
    const rejected = settled.filter((row) => row.status === 'rejected');
    const deadlockLike = rejected.filter((row) => {
      if (row.status !== 'rejected') {
        return false;
      }
      const message =
        row.reason instanceof Error ? row.reason.message : String(row.reason);
      return /deadlock/i.test(message);
    });
    // Sorted discountId locks must prevent deadlocks; RR serialization conflicts
    // after retries may still surface as CREATE_CONFLICT under stampede.
    expect(deadlockLike).toHaveLength(0);
    expect(fulfilled.length).toBeGreaterThan(0);
    for (const row of rejected) {
      if (row.status !== 'rejected') {
        continue;
      }
      expect(row.reason).toBeInstanceOf(OrderInvalidInputError);
    }

    const usageAUserA = await usageRepo.findUsage(discountA.id, userA.id);
    const usageBUserA = await usageRepo.findUsage(discountB.id, userA.id);
    const usageAUserB = await usageRepo.findUsage(discountA.id, userB.id);
    const usageBUserB = await usageRepo.findUsage(discountB.id, userB.id);
    const fulfilledA = fulfilled.filter(
      (row) =>
        row.status === 'fulfilled' && row.value.order.userId === userA.id,
    ).length;
    const fulfilledB = fulfilled.filter(
      (row) =>
        row.status === 'fulfilled' && row.value.order.userId === userB.id,
    ).length;
    expect(usageAUserA?.consumedQuantity ?? 0).toBe(fulfilledA);
    expect(usageBUserA?.consumedQuantity ?? 0).toBe(fulfilledA);
    expect(usageAUserB?.consumedQuantity ?? 0).toBe(fulfilledB);
    expect(usageBUserB?.consumedQuantity ?? 0).toBe(fulfilledB);
    expect(usageAUserA?.consumedQuantity ?? 0).toBeLessThanOrEqual(10);
    expect(usageBUserA?.consumedQuantity ?? 0).toBeLessThanOrEqual(10);
  }, 90_000);

  it('same-user multi-SKU opposite-line-order stampede respects caps without deadlock', async () => {
    const user = await users.create({ phone: nextPhone() });
    const region = await regions.create({ name: `Region ${randomUUID()}` });
    const category = await categories.create({ name: `Cat ${randomUUID()}` });
    const productA = await products.create({
      name: `SKU-A ${randomUUID()}`,
      price: 8_000,
      categoryId: category.id,
    });
    const productB = await products.create({
      name: `SKU-B ${randomUUID()}`,
      price: 9_000,
      categoryId: category.id,
    });
    for (const productId of [productA.id, productB.id]) {
      await inventory.ensureForProduct(productId);
      await inventory.receiveOnHand({
        productId,
        quantity: 200,
        referenceType: InventoryLedgerReferenceType.RECEIVE,
        referenceId: randomUUID(),
        actor: SYSTEM_ACTOR,
      });
    }
    const capA = 4;
    const capB = 5;
    const discountA = await discounts.create({
      name: `Cap A ${randomUUID()}`,
      type: DiscountType.PERCENT,
      target: DiscountTarget.PRODUCT,
      percentValue: 10,
      productId: productA.id,
      precedence: 10,
      maxQuantityPerCustomer: capA,
    });
    const discountB = await discounts.create({
      name: `Cap B ${randomUUID()}`,
      type: DiscountType.PERCENT,
      target: DiscountTarget.PRODUCT,
      percentValue: 10,
      productId: productB.id,
      precedence: 10,
      maxQuantityPerCustomer: capB,
    });

    // One user, opposite line order across concurrent creates — sorted discountId
    // locks must prevent deadlock while combined usage stays within each cap.
    const settled = await Promise.allSettled([
      ...Array.from({ length: 10 }, () =>
        creation.createOrder({
          actor: { type: OrderActorType.USER, id: user.id },
          regionId: region.id,
          idempotencyKey: randomUUID(),
          lines: [
            { productId: productA.id, quantity: 1 },
            { productId: productB.id, quantity: 1 },
          ],
        }),
      ),
      ...Array.from({ length: 10 }, () =>
        creation.createOrder({
          actor: { type: OrderActorType.USER, id: user.id },
          regionId: region.id,
          idempotencyKey: randomUUID(),
          lines: [
            { productId: productB.id, quantity: 1 },
            { productId: productA.id, quantity: 1 },
          ],
        }),
      ),
    ]);

    const fulfilled = settled.filter((row) => row.status === 'fulfilled');
    const rejected = settled.filter((row) => row.status === 'rejected');
    const deadlockLike = rejected.filter((row) => {
      if (row.status !== 'rejected') {
        return false;
      }
      const message =
        row.reason instanceof Error ? row.reason.message : String(row.reason);
      return /deadlock/i.test(message);
    });
    expect(deadlockLike).toHaveLength(0);
    expect(fulfilled.length).toBeGreaterThan(0);
    for (const row of rejected) {
      if (row.status !== 'rejected') {
        continue;
      }
      expect(row.reason).toBeInstanceOf(OrderInvalidInputError);
    }

    const usageA = await usageRepo.findUsage(discountA.id, user.id);
    const usageB = await usageRepo.findUsage(discountB.id, user.id);
    expect(usageA?.consumedQuantity ?? 0).toBeLessThanOrEqual(capA);
    expect(usageB?.consumedQuantity ?? 0).toBeLessThanOrEqual(capB);
    expect(usageA?.consumedQuantity ?? 0).toBeGreaterThan(0);
    expect(usageB?.consumedQuantity ?? 0).toBeGreaterThan(0);
  }, 90_000);

  it('double consumeForOrder in one transaction commits via ON CONFLICT DO NOTHING', async () => {
    const { user, discount } = await seedBase({
      maxQuantityPerCustomer: 5,
    });
    const orderId = randomUUID();

    await transactions.runRepeatableRead(async (tx) => {
      await usageRepo.lockUsageAggregates(user.id, [discount.id], tx);
      await usageRepo.consumeForOrder(
        {
          orderId,
          userId: user.id,
          consumptions: [{ discountId: discount.id, quantity: 2 }],
        },
        tx,
      );
      // Replay in the same TX must not abort (25P02) — ON CONFLICT DO NOTHING.
      await usageRepo.consumeForOrder(
        {
          orderId,
          userId: user.id,
          consumptions: [{ discountId: discount.id, quantity: 2 }],
        },
        tx,
      );
      // Prove the transaction remains usable after the conflict skip.
      const midTx = await usageRepo.findUsage(discount.id, user.id, tx);
      expect(midTx?.consumedQuantity).toBe(2);
    });

    expect(await usageRepo.findUsage(discount.id, user.id)).toMatchObject({
      consumedQuantity: 2,
    });
    const records = await usageRepo.listRecordsForOrder(orderId);
    expect(records).toEqual([
      expect.objectContaining({
        kind: DiscountUsageRecordKind.CONSUME,
        quantity: 2,
        discountId: discount.id,
      }),
    ]);
  });

  it('rejects maxQuantityPerCustomer on CATEGORY and ORDER discounts', async () => {
    const category = await categories.create({ name: `Cat ${randomUUID()}` });

    await expect(
      discounts.create({
        name: `Category capped ${randomUUID()}`,
        type: DiscountType.PERCENT,
        target: DiscountTarget.CATEGORY,
        percentValue: 10,
        categoryId: category.id,
        maxQuantityPerCustomer: 3,
      }),
    ).rejects.toBeInstanceOf(DiscountInvalidTargetError);

    await expect(
      discounts.create({
        name: `Order capped ${randomUUID()}`,
        type: DiscountType.PERCENT,
        target: DiscountTarget.ORDER,
        percentValue: 10,
        maxQuantityPerCustomer: 3,
      }),
    ).rejects.toBeInstanceOf(DiscountInvalidTargetError);
  });
});

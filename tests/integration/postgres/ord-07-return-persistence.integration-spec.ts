import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../../src/generated/prisma/client';
import { postgresIntegrationImports } from '../support/postgres-testing-module';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { TransactionRunner } from '../../../src/infrastructure/database/transaction';
import { CategoryRepository } from '../../../src/modules/categories/infrastructure/category.repository';
import { ProductRepository } from '../../../src/modules/products/infrastructure/product.repository';
import { RegionRepository } from '../../../src/modules/regions/infrastructure/region.repository';
import { UserRepository } from '../../../src/modules/users/infrastructure/user.repository';
import { OrdersModule } from '../../../src/modules/orders/orders.module';
import { UsersModule } from '../../../src/modules/users/users.module';
import { OrderRepository } from '../../../src/modules/orders/infrastructure/order.repository';
import { OrderReturnRepository } from '../../../src/modules/orders/infrastructure/order-return.repository';
import { OrderReturnService } from '../../../src/modules/orders/application/order-return.service';
import { OrderTransitionService } from '../../../src/modules/orders/application/order-transition.service';
import { AuditAction } from '../../../src/modules/audit/domain/audit-event';
import { AuditLogService } from '../../../src/modules/audit/application/audit-log.service';
import type { RecordOrderReturnCommand } from '../../../src/modules/orders/application/order-return.commands';
import {
  InventoryService,
  SYSTEM_ACTOR,
} from '../../../src/modules/inventory/application/inventory.service';
import {
  InventoryLedgerReferenceType,
  InventoryLedgerType,
} from '../../../src/modules/inventory/domain/inventory-ledger';
import { OrderStatus } from '../../../src/modules/orders/domain/order-status';
import {
  OrderInvalidInputError,
  OrderReturnQuantityExceededError,
} from '../../../src/modules/orders/domain/order-errors';
import { hashOrderCreatePayload } from '../../../src/modules/orders/domain/order-create-idempotency';
import type {
  TrustedCreateOrderInput,
  OrderRecord,
  OrderLineRecord,
} from '../../../src/modules/orders/domain/order';
import type { OrderReturnRecord } from '../../../src/modules/orders/domain/order-return';

async function truncateTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "OrderReturnLine", "OrderReturn", "OrderLine", "Order", "InventoryLedger", "InventoryReservation", "Inventory", "Admin", "Product", "Category", "Region", "User" RESTART IDENTITY CASCADE',
  );
}

describe('ORD-07 return persistence (PostgreSQL integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let users: UserRepository;
  let regions: RegionRepository;
  let categories: CategoryRepository;
  let products: ProductRepository;
  let orders: OrderRepository;
  let returns: OrderReturnRepository;
  let transactions: TransactionRunner;
  let returnService: OrderReturnService;
  let transitions: OrderTransitionService;
  let audit: AuditLogService;
  let inventory: InventoryService;
  let phoneCounter = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [...postgresIntegrationImports([UsersModule, OrdersModule])],
      providers: [RegionRepository, CategoryRepository, ProductRepository],
    }).compile();
    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    users = moduleRef.get(UserRepository);
    regions = moduleRef.get(RegionRepository);
    categories = moduleRef.get(CategoryRepository);
    products = moduleRef.get(ProductRepository);
    orders = moduleRef.get(OrderRepository);
    returns = moduleRef.get(OrderReturnRepository);
    transactions = moduleRef.get(TransactionRunner);
    returnService = moduleRef.get(OrderReturnService);
    transitions = moduleRef.get(OrderTransitionService);
    audit = moduleRef.get(AuditLogService);
    inventory = moduleRef.get(InventoryService);
    await app.init();
  });

  async function deliveredContext(): Promise<
    Awaited<ReturnType<typeof context>>
  > {
    const seeded = await context();
    await prisma.order.update({
      where: { id: seeded.order.id },
      data: {
        status: OrderStatus.DELIVERED,
        confirmedAt: new Date('2026-08-30T10:00:00.000Z'),
        shippedAt: new Date('2026-08-31T10:00:00.000Z'),
        deliveredAt: new Date('2026-09-01T10:00:00.000Z'),
      },
    });
    await inventory.ensureForProduct(seeded.line.productId);
    await inventory.receiveOnHand({
      productId: seeded.line.productId,
      quantity: 10,
      referenceType: InventoryLedgerReferenceType.RECEIVE,
      referenceId: null,
      actor: SYSTEM_ACTOR,
    });
    return seeded;
  }

  function recordCommand(input: {
    orderId: string;
    adminId: string;
    lineId: string;
    key: string;
    sellableQuantity: number;
    damagedQuantity?: number;
  }): RecordOrderReturnCommand {
    return {
      orderId: input.orderId,
      idempotencyKey: input.key,
      reason: 'inspection complete',
      lines: [
        {
          orderLineId: input.lineId,
          sellableQuantity: input.sellableQuantity,
          damagedQuantity: input.damagedQuantity ?? 0,
        },
      ],
      actor: { type: 'ADMIN' as const, id: input.adminId },
    };
  }

  beforeEach(() => truncateTables(prisma));
  afterAll(() => app.close());

  async function addSecondDeliveredLine(input: {
    order: OrderRecord;
    firstLine: OrderLineRecord;
  }): Promise<OrderLineRecord> {
    const firstProduct = await prisma.product.findUniqueOrThrow({
      where: { id: input.firstLine.productId },
    });
    const product = await products.create({
      name: 'Duck eggs',
      price: 1200,
      categoryId: firstProduct.categoryId,
    });
    const quantity = 10;
    const total = BigInt(quantity * product.price);
    const line = await prisma.orderLine.create({
      data: {
        id: randomUUID(),
        orderId: input.order.id,
        productId: product.id,
        productName: product.name,
        unitPrice: product.price,
        quantity,
        discountedQuantity: 0,
        grossLineTotal: total,
        lineDiscountAmount: 0n,
        finalLineTotal: total,
      },
    });
    await inventory.ensureForProduct(product.id);
    await inventory.receiveOnHand({
      productId: product.id,
      quantity: 10,
      referenceType: InventoryLedgerReferenceType.RECEIVE,
      referenceId: null,
      actor: SYSTEM_ACTOR,
    });
    return {
      ...line,
      grossLineTotal: BigInt(line.grossLineTotal),
      lineDiscountAmount: BigInt(line.lineDiscountAmount),
      finalLineTotal: BigInt(line.finalLineTotal),
      appliedLineDiscount: null,
    };
  }

  async function context(): Promise<{
    admin: { id: string };
    order: OrderRecord;
    line: OrderLineRecord;
  }> {
    phoneCounter += 1;
    const user = await users.create({
      phone: `+98912${String(phoneCounter).padStart(7, '0')}`,
    });
    const region = await regions.create({ name: 'Tehran North' });
    const category = await categories.create({ name: 'Eggs' });
    const product = await products.create({
      name: 'Eggs',
      price: 1000,
      categoryId: category.id,
    });
    const admin = await prisma.admin.create({
      data: {
        email: `return-${phoneCounter}@example.com`,
        passwordHash: 'not-a-login-secret',
        role: 'SUPER_ADMIN',
      },
    });
    const quantity = 10;
    const total = BigInt(quantity * product.price);
    const input: TrustedCreateOrderInput = {
      userId: user.id,
      customerPhone: user.phone,
      regionId: region.id,
      regionName: region.name,
      idempotencyKey: randomUUID(),
      idempotencyPayloadHash: hashOrderCreatePayload({
        regionId: region.id,
        lines: [{ productId: product.id, quantity }],
      }),
      pricingEvaluatedAt: new Date('2026-09-01T00:00:00.000Z'),
      commercePolicyRevision: 1,
      grossSubtotal: total,
      lineDiscountTotal: 0n,
      subtotalAfterLineDiscounts: total,
      orderDiscountAmount: 0n,
      total,
      appliedOrderDiscount: null,
      lines: [
        {
          productId: product.id,
          productName: product.name,
          unitPrice: product.price,
          quantity,
          discountedQuantity: 0,
          grossLineTotal: total,
          lineDiscountAmount: 0n,
          finalLineTotal: total,
          appliedLineDiscount: null,
        },
      ],
    };
    const order = await orders.createWithTrustedSnapshots(input);
    return { admin, order, line: order.lines[0]! };
  }

  async function createReturn(input: {
    orderId: string;
    adminId: string;
    lineId: string;
    key?: string;
    sellableQuantity?: number;
    damagedQuantity?: number;
  }): Promise<OrderReturnRecord> {
    return transactions.run(async (tx) =>
      returns.createWithLines(
        {
          orderId: input.orderId,
          recordedByAdminId: input.adminId,
          reason: 'inspection complete',
          idempotencyKey: input.key ?? randomUUID(),
          idempotencyPayloadHash: 'a'.repeat(64),
          lines: [
            {
              orderLineId: input.lineId,
              sellableQuantity: input.sellableQuantity ?? 1,
              damagedQuantity: input.damagedQuantity ?? 0,
            },
          ],
        },
        tx,
      ),
    );
  }

  it('supports multiple return events for the same order line and deterministic reads', async () => {
    const { admin, order, line } = await context();
    const first = await createReturn({
      orderId: order.id,
      adminId: admin.id,
      lineId: line.id,
      sellableQuantity: 3,
    });
    const second = await createReturn({
      orderId: order.id,
      adminId: admin.id,
      lineId: line.id,
      sellableQuantity: 0,
      damagedQuantity: 4,
    });
    expect(
      (await returns.listByOrderId(order.id)).map((item) => item.id),
    ).toEqual([first.id, second.id]);
    expect(
      await transactions.run((tx) =>
        returns.sumReturnedQuantityByOrderLine(line.id, tx),
      ),
    ).toBe(7);
  });

  it.each([
    ['negative sellable', { sellableQuantity: -1, damagedQuantity: 1 }],
    ['negative damaged', { sellableQuantity: 1, damagedQuantity: -1 }],
    ['zero total', { sellableQuantity: 0, damagedQuantity: 0 }],
  ])('enforces quantity CHECK: %s', async (_name, quantities) => {
    const { admin, order, line } = await context();
    const returnId = randomUUID();
    await prisma.orderReturn.create({
      data: {
        id: returnId,
        orderId: order.id,
        recordedByAdminId: admin.id,
        reason: 'inspection complete',
        idempotencyKey: randomUUID(),
        idempotencyPayloadHash: 'b'.repeat(64),
      },
    });
    await expect(
      prisma.orderReturnLine.create({
        data: {
          id: randomUUID(),
          returnId,
          orderLineId: line.id,
          ...quantities,
        },
      }),
    ).rejects.toThrow();
  });

  it('persists payload proof and enforces idempotency-key uniqueness', async () => {
    const { admin, order, line } = await context();
    const key = randomUUID();
    await createReturn({
      orderId: order.id,
      adminId: admin.id,
      lineId: line.id,
      key,
    });
    expect(
      (await returns.findByIdempotencyKey(key))?.idempotencyPayloadHash,
    ).toBe('a'.repeat(64));
    await expect(
      createReturn({
        orderId: order.id,
        adminId: admin.id,
        lineId: line.id,
        key,
      }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('keeps returnedAt nullable and independent from return creation', async () => {
    const { admin, order, line } = await context();
    await createReturn({
      orderId: order.id,
      adminId: admin.id,
      lineId: line.id,
    });
    expect((await orders.findById(order.id))?.returnedAt).toBeNull();
  });

  it('records a delivered return atomically, replays once, and leaves the order delivered', async () => {
    const { admin, order, line } = await deliveredContext();
    const key = randomUUID();
    const command = recordCommand({
      orderId: order.id,
      adminId: admin.id,
      lineId: line.id,
      key,
      sellableQuantity: 2,
      damagedQuantity: 1,
    });
    const first = await returnService.recordReturn(command);
    const replay = await returnService.recordReturn(command);
    const balance = await inventory.getBalance(line.productId);
    const ledgers = await prisma.inventoryLedger.findMany({
      where: { type: InventoryLedgerType.RETURN_TO_STOCK },
    });

    expect(first.replay).toBe(false);
    expect(replay).toEqual({ orderReturn: first.orderReturn, replay: true });
    expect(balance).toMatchObject({ onHand: 12, reserved: 0 });
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0]).toMatchObject({
      referenceType: InventoryLedgerReferenceType.RETURN,
      referenceId: first.orderReturn.id,
      quantity: 2,
      onHandDelta: 2,
      reservedDelta: 0,
    });
    expect(await orders.findById(order.id)).toMatchObject({
      status: OrderStatus.DELIVERED,
      returnedAt: null,
      total: order.total,
    });
  });

  it('serializes a same-key PostgreSQL race to one logical return and one restock', async () => {
    const { admin, order, line } = await deliveredContext();
    const command = recordCommand({
      orderId: order.id,
      adminId: admin.id,
      lineId: line.id,
      key: randomUUID(),
      sellableQuantity: 3,
    });
    const callers = await Promise.allSettled([
      returnService.recordReturn(command),
      returnService.recordReturn(command),
    ]);
    const fulfilled = callers.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof returnService.recordReturn>>
      > => result.status === 'fulfilled',
    );
    const returnCount = await prisma.orderReturn.count({
      where: { orderId: order.id },
    });
    const returnLineCount = await prisma.orderReturnLine.count();
    const returned = await transactions.run((tx) =>
      returns.sumReturnedQuantityByOrderLine(line.id, tx),
    );
    const balance = await inventory.getBalance(line.productId);
    const ledgerCount = await prisma.inventoryLedger.count({
      where: { type: InventoryLedgerType.RETURN_TO_STOCK },
    });

    expect(fulfilled).toHaveLength(2);
    expect(fulfilled.filter((result) => !result.value.replay)).toHaveLength(1);
    expect(fulfilled.filter((result) => result.value.replay)).toHaveLength(1);
    expect(returnCount).toBe(1);
    expect(returnLineCount).toBe(1);
    expect(returned).toBe(3);
    expect(balance).toMatchObject({ onHand: 13, reserved: 0 });
    expect(ledgerCount).toBe(1);
  });

  it('rejects a changed same-key payload without a second business effect', async () => {
    const { admin, order, line } = await deliveredContext();
    const key = randomUUID();
    await returnService.recordReturn(
      recordCommand({
        orderId: order.id,
        adminId: admin.id,
        lineId: line.id,
        key,
        sellableQuantity: 2,
      }),
    );
    await expect(
      returnService.recordReturn(
        recordCommand({
          orderId: order.id,
          adminId: admin.id,
          lineId: line.id,
          key,
          sellableQuantity: 3,
        }),
      ),
    ).rejects.toMatchObject({ code: 'ORDER_IDEMPOTENCY_CONFLICT' });
    expect(await prisma.orderReturn.count()).toBe(1);
    expect(
      await transactions.run((tx) =>
        returns.sumReturnedQuantityByOrderLine(line.id, tx),
      ),
    ).toBe(2);
    expect(await inventory.getBalance(line.productId)).toMatchObject({
      onHand: 12,
      reserved: 0,
    });
    expect(
      await prisma.inventoryLedger.count({
        where: { type: InventoryLedgerType.RETURN_TO_STOCK },
      }),
    ).toBe(1);
  });

  it('persists one multi-SKU return event with durable RETURN ledger references', async () => {
    const { admin, order, line } = await deliveredContext();
    const secondLine = await addSecondDeliveredLine({ order, firstLine: line });
    const result = await returnService.recordReturn({
      orderId: order.id,
      idempotencyKey: randomUUID(),
      reason: 'multi sku inspection',
      actor: { type: 'ADMIN', id: admin.id },
      lines: [
        { orderLineId: secondLine.id, sellableQuantity: 0, damagedQuantity: 2 },
        { orderLineId: line.id, sellableQuantity: 3, damagedQuantity: 1 },
      ],
    });
    const [firstBalance, secondBalance, persisted, ledgers] = await Promise.all(
      [
        inventory.getBalance(line.productId),
        inventory.getBalance(secondLine.productId),
        prisma.orderReturn.findMany({
          where: { orderId: order.id },
          include: { lines: true },
        }),
        prisma.inventoryLedger.findMany({
          where: { type: InventoryLedgerType.RETURN_TO_STOCK },
        }),
      ],
    );

    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.lines).toHaveLength(2);
    expect(firstBalance).toMatchObject({ onHand: 13, reserved: 0 });
    expect(secondBalance).toMatchObject({ onHand: 10, reserved: 0 });
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0]).toMatchObject({
      productId: line.productId,
      referenceType: InventoryLedgerReferenceType.RETURN,
      referenceId: result.orderReturn.id,
      quantity: 3,
      onHandDelta: 3,
      reservedDelta: 0,
    });
  });

  it('allows sequential returns up to the cap and rejects an over-return without effects', async () => {
    const { admin, order, line } = await deliveredContext();
    for (const quantity of [6, 4]) {
      await returnService.recordReturn(
        recordCommand({
          orderId: order.id,
          adminId: admin.id,
          lineId: line.id,
          key: randomUUID(),
          sellableQuantity: quantity,
        }),
      );
    }
    await expect(
      returnService.recordReturn(
        recordCommand({
          orderId: order.id,
          adminId: admin.id,
          lineId: line.id,
          key: randomUUID(),
          sellableQuantity: 1,
        }),
      ),
    ).rejects.toThrow(OrderReturnQuantityExceededError);
    expect(
      await transactions.run((tx) =>
        returns.sumReturnedQuantityByOrderLine(line.id, tx),
      ),
    ).toBe(10);
    expect(await inventory.getBalance(line.productId)).toMatchObject({
      onHand: 20,
      reserved: 0,
    });
    expect(
      await prisma.inventoryLedger.count({
        where: { type: InventoryLedgerType.RETURN_TO_STOCK },
      }),
    ).toBe(2);
  });

  it('rolls back an event containing a valid and a foreign line with no partial effects', async () => {
    const target = await deliveredContext();
    const foreign = await context();
    const before = await inventory.getBalance(target.line.productId);
    await expect(
      returnService.recordReturn({
        orderId: target.order.id,
        idempotencyKey: randomUUID(),
        reason: 'mixed validity',
        actor: { type: 'ADMIN', id: target.admin.id },
        lines: [
          {
            orderLineId: target.line.id,
            sellableQuantity: 2,
            damagedQuantity: 0,
          },
          {
            orderLineId: foreign.line.id,
            sellableQuantity: 1,
            damagedQuantity: 0,
          },
        ],
      }),
    ).rejects.toThrow(OrderInvalidInputError);
    expect(await prisma.orderReturn.count()).toBe(0);
    expect(await prisma.orderReturnLine.count()).toBe(0);
    expect(await inventory.getBalance(target.line.productId)).toEqual(before);
    expect(
      await prisma.inventoryLedger.count({
        where: { type: InventoryLedgerType.RETURN_TO_STOCK },
      }),
    ).toBe(0);
  });

  it('serializes different-key over-return attempts with final state evidence', async () => {
    const { admin, order, line } = await deliveredContext();
    const [left, right] = await Promise.allSettled([
      returnService.recordReturn(
        recordCommand({
          orderId: order.id,
          adminId: admin.id,
          lineId: line.id,
          key: randomUUID(),
          sellableQuantity: 7,
        }),
      ),
      returnService.recordReturn(
        recordCommand({
          orderId: order.id,
          adminId: admin.id,
          lineId: line.id,
          key: randomUUID(),
          sellableQuantity: 7,
        }),
      ),
    ]);
    const fulfilled = [left, right].filter(
      (result) => result.status === 'fulfilled',
    );
    const returned = await transactions.run((tx) =>
      returns.sumReturnedQuantityByOrderLine(line.id, tx),
    );
    const balance = await inventory.getBalance(line.productId);
    const returnCount = await prisma.orderReturn.count({
      where: { orderId: order.id },
    });
    const ledgerCount = await prisma.inventoryLedger.count({
      where: { type: InventoryLedgerType.RETURN_TO_STOCK },
    });

    expect(fulfilled).toHaveLength(1);
    expect(returned).toBe(7);
    expect(balance).toMatchObject({ onHand: 17, reserved: 0 });
    expect(returnCount).toBe(1);
    expect(ledgerCount).toBe(1);
  });

  it('explicitly completes a delivered return process without a recorded return or Inventory effects', async () => {
    const { admin, order, line } = await deliveredContext();
    const beforeBalance = await inventory.getBalance(line.productId);
    const beforeLedgerCount = await prisma.inventoryLedger.count();

    const first = await transitions.completeReturnProcess({
      orderId: order.id,
      actor: { type: 'ADMIN', id: admin.id },
    });
    const replay = await transitions.completeReturnProcess({
      orderId: order.id,
      actor: { type: 'ADMIN', id: admin.id },
    });

    expect(first).toMatchObject({
      replay: false,
      order: { status: 'RETURNED' },
    });
    expect(first.order.returnedAt).toBeInstanceOf(Date);
    expect(replay).toMatchObject({
      replay: true,
      order: { status: 'RETURNED' },
    });
    expect(replay.order.returnedAt).toEqual(first.order.returnedAt);
    expect(
      await prisma.orderReturn.count({ where: { orderId: order.id } }),
    ).toBe(0);
    expect(await prisma.orderReturnLine.count()).toBe(0);
    expect(await inventory.getBalance(line.productId)).toEqual(beforeBalance);
    expect(await prisma.inventoryLedger.count()).toBe(beforeLedgerCount);
    expect(
      await prisma.auditLog.count({
        where: { action: AuditAction.ORDER_RETURNED, entityId: order.id },
      }),
    ).toBe(1);
  });

  it('preserves non-zero financial snapshots, DLU usage, and settlement on return recording and completion', async () => {
    const { admin, order, line } = await deliveredContext();
    const discount = await prisma.discount.create({
      data: {
        name: 'Historical return discount',
        type: 'PERCENT',
        target: 'PRODUCT',
        percentValue: 10,
        productId: line.productId,
        maxQuantityPerCustomer: 10,
      },
    });
    await prisma.discountCustomerUsage.create({
      data: {
        discountId: discount.id,
        userId: order.userId,
        consumedQuantity: 4,
      },
    });
    await prisma.discountUsageRecord.create({
      data: {
        discountId: discount.id,
        userId: order.userId,
        orderId: order.id,
        kind: 'CONSUME',
        quantity: 4,
      },
    });
    await prisma.orderSettlement.create({
      data: {
        orderId: order.id,
        dueAt: new Date('2026-09-15T00:00:00.000Z'),
        createdByAdminId: admin.id,
      },
    });

    const beforeOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { lines: true },
    });
    const beforeUsage = await prisma.discountCustomerUsage.findUniqueOrThrow({
      where: {
        discountId_userId: { discountId: discount.id, userId: order.userId },
      },
    });
    const beforeSettlement = await prisma.orderSettlement.findUniqueOrThrow({
      where: { orderId: order.id },
    });

    await returnService.recordReturn(
      recordCommand({
        orderId: order.id,
        adminId: admin.id,
        lineId: line.id,
        key: randomUUID(),
        sellableQuantity: 2,
      }),
    );
    await transitions.completeReturnProcess({
      orderId: order.id,
      actor: { type: 'ADMIN', id: admin.id },
    });

    const afterOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { lines: true },
    });
    const afterUsage = await prisma.discountCustomerUsage.findUniqueOrThrow({
      where: {
        discountId_userId: { discountId: discount.id, userId: order.userId },
      },
    });
    const afterSettlement = await prisma.orderSettlement.findUniqueOrThrow({
      where: { orderId: order.id },
    });

    expect(afterOrder.total).toBe(beforeOrder.total);
    expect(afterOrder.lines).toEqual(beforeOrder.lines);
    expect(afterUsage).toEqual(beforeUsage);
    expect(afterSettlement).toEqual(beforeSettlement);
  });

  it('rolls back return completion when the required audit append fails', async () => {
    const { admin, order } = await deliveredContext();
    jest
      .spyOn(audit, 'append')
      .mockRejectedValueOnce(new Error('audit failure'));

    await expect(
      transitions.completeReturnProcess({
        orderId: order.id,
        actor: { type: 'ADMIN', id: admin.id },
      }),
    ).rejects.toThrow('audit failure');

    expect(await orders.findById(order.id)).toMatchObject({
      status: OrderStatus.DELIVERED,
      returnedAt: null,
    });
    expect(
      await prisma.auditLog.count({
        where: { action: AuditAction.ORDER_RETURNED, entityId: order.id },
      }),
    ).toBe(0);
    jest.restoreAllMocks();
  });

  it('serializes concurrent completion attempts to one transition and one audit fact', async () => {
    const { admin, order, line } = await deliveredContext();
    const beforeBalance = await inventory.getBalance(line.productId);
    const beforeReturns = await prisma.orderReturn.count({
      where: { orderId: order.id },
    });
    const callers = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        transitions.completeReturnProcess({
          orderId: order.id,
          actor: { type: 'ADMIN', id: admin.id },
        }),
      ),
    );
    const fulfilled = callers.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof transitions.completeReturnProcess>>
      > => result.status === 'fulfilled',
    );
    const final = await orders.findById(order.id);

    expect(fulfilled).toHaveLength(8);
    expect(fulfilled.filter((result) => !result.value.replay)).toHaveLength(1);
    expect(fulfilled.filter((result) => result.value.replay)).toHaveLength(7);
    expect(final).toMatchObject({ status: OrderStatus.RETURNED });
    expect(final?.returnedAt).toEqual(fulfilled[0]?.value.order.returnedAt);
    expect(
      await prisma.auditLog.count({
        where: { action: AuditAction.ORDER_RETURNED, entityId: order.id },
      }),
    ).toBe(1);
    expect(await inventory.getBalance(line.productId)).toEqual(beforeBalance);
    expect(
      await prisma.orderReturn.count({ where: { orderId: order.id } }),
    ).toBe(beforeReturns);
  });

  it('serializes return recording against completion without a post-completion return', async () => {
    const { admin, order, line } = await deliveredContext();
    const beforeBalance = await inventory.getBalance(line.productId);
    if (beforeBalance === null)
      throw new Error('Expected seeded Inventory balance.');
    const outcomes = await Promise.allSettled([
      returnService.recordReturn(
        recordCommand({
          orderId: order.id,
          adminId: admin.id,
          lineId: line.id,
          key: randomUUID(),
          sellableQuantity: 2,
        }),
      ),
      transitions.completeReturnProcess({
        orderId: order.id,
        actor: { type: 'ADMIN', id: admin.id },
      }),
    ]);
    const final = await orders.findById(order.id);
    const returnCount = await prisma.orderReturn.count({
      where: { orderId: order.id },
    });
    const returnLineCount = await prisma.orderReturnLine.count();
    const ledgerCount = await prisma.inventoryLedger.count({
      where: { type: InventoryLedgerType.RETURN_TO_STOCK },
    });

    expect(final).toMatchObject({ status: OrderStatus.RETURNED });
    expect(final?.returnedAt).toBeInstanceOf(Date);
    expect(
      await prisma.auditLog.count({
        where: { action: AuditAction.ORDER_RETURNED, entityId: order.id },
      }),
    ).toBe(1);
    expect(returnCount).toBeLessThanOrEqual(1);
    expect(returnLineCount).toBe(returnCount);
    expect(ledgerCount).toBe(returnCount);
    expect(outcomes.some((result) => result.status === 'fulfilled')).toBe(true);
    expect(await inventory.getBalance(line.productId)).toMatchObject({
      onHand: beforeBalance.onHand + returnCount * 2,
      reserved: beforeBalance.reserved,
    });
  });

  it('restricts deletion of referenced order, line, and admin history', async () => {
    const { admin, order, line } = await context();
    await createReturn({
      orderId: order.id,
      adminId: admin.id,
      lineId: line.id,
    });
    await expect(
      prisma.admin.delete({ where: { id: admin.id } }),
    ).rejects.toThrow();
    await expect(
      prisma.orderLine.delete({ where: { id: line.id } }),
    ).rejects.toThrow();
    await expect(
      prisma.order.delete({ where: { id: order.id } }),
    ).rejects.toThrow();
  });
});

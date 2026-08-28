import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  postgresIntegrationImports,
  unusedPricingServiceProvider,
} from '../support/postgres-testing-module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { TransactionRunner } from '../../../src/infrastructure/database/transaction';
import { CategoryService } from '../../../src/modules/categories/application/category.service';
import { CategoryRepository } from '../../../src/modules/categories/infrastructure/category.repository';
import {
  InventoryService,
  SYSTEM_ACTOR,
} from '../../../src/modules/inventory/application/inventory.service';
import { InventoryReservationNotFoundError } from '../../../src/modules/inventory/domain/inventory-errors';
import { InventoryLedgerReferenceType } from '../../../src/modules/inventory/domain/inventory-ledger';
import { InventoryModule } from '../../../src/modules/inventory/inventory.module';
import { OrderActorType } from '../../../src/modules/orders/domain/order-actor';
import {
  OrderInvalidTransitionError,
  OrderNotFoundError,
} from '../../../src/modules/orders/domain/order-errors';
import { OrderMessage } from '../../../src/modules/orders/domain/order-messages';
import { OrderStatus } from '../../../src/modules/orders/domain/order-status';
import { OrderTransitionService } from '../../../src/modules/orders/application/order-transition.service';
import { OrderRepository } from '../../../src/modules/orders/infrastructure/order.repository';
import { OrdersModule } from '../../../src/modules/orders/orders.module';
import { ProductService } from '../../../src/modules/products/application/product.service';
import { ProductRepository } from '../../../src/modules/products/infrastructure/product.repository';
import { RegionRepository } from '../../../src/modules/regions/infrastructure/region.repository';
import type { UserRecord } from '../../../src/modules/users/domain/user';
import { UserRepository } from '../../../src/modules/users/infrastructure/user.repository';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

function uniquePhone(suffix: number): string {
  const national = `912${String(suffix).padStart(7, '0')}`.slice(0, 10);
  return `+98${national}`;
}

async function truncateOrderTransitionTables(
  prisma: PrismaService,
): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "OutboxEvent", "DiscountUsageRecord", "DiscountCustomerUsage", "InventoryLedger", "InventoryReservation", "Inventory", "OrderLine", "Order", "Product", "Category", "Region", "User" RESTART IDENTITY CASCADE',
  );
}

describe('Order transitions (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let users: UserRepository;
  let regions: RegionRepository;
  let categories: CategoryRepository;
  let productService: ProductService;
  let orders: OrderRepository;
  let transitions: OrderTransitionService;
  let inventory: InventoryService;
  let transactions: TransactionRunner;
  let phoneCounter = 0;

  const admin = {
    type: OrderActorType.ADMIN,
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  } as const;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [...postgresIntegrationImports([InventoryModule, OrdersModule])],
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
    inventory = moduleRef.get(InventoryService);
    transactions = moduleRef.get(TransactionRunner);
    await app.init();
  });

  beforeEach(async () => {
    await truncateOrderTransitionTables(prisma);
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
    reserve?: boolean;
  }): Promise<{
    orderId: string;
    productId: string;
    user: UserRecord;
    customer: { type: typeof OrderActorType.USER; id: string };
  }> {
    const onHand = options?.onHand ?? 10;
    const quantity = options?.quantity ?? 2;
    const reserve = options?.reserve ?? true;
    const user = await users.create({ phone: nextPhone() });
    const region = await regions.create({ name: `Region ${randomUUID()}` });
    const category = await categories.create({ name: `Cat ${randomUUID()}` });
    const product = await productService.create({
      name: `Eggs ${randomUUID()}`,
      price: 1000,
      categoryId: category.id,
    });
    if (onHand > 0) {
      await inventory.receiveOnHand({
        productId: product.id,
        quantity: onHand,
        referenceType: InventoryLedgerReferenceType.RECEIVE,
        referenceId: randomUUID(),
        actor: SYSTEM_ACTOR,
      });
    }
    const gross = BigInt(product.price) * BigInt(quantity);
    const idempotencyKey = randomUUID();
    const created = await orders.createWithTrustedSnapshots({
      userId: user.id,
      customerPhone: user.phone,
      regionId: region.id,
      regionName: region.name,
      idempotencyKey,
      idempotencyPayloadHash: 'b'.repeat(64),
      pricingEvaluatedAt: new Date('2026-08-22T12:00:00.000Z'),
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
    if (reserve) {
      await inventory.reserveForOrder({
        orderId: created.id,
        lines: [{ productId: product.id, quantity }],
        actor: SYSTEM_ACTOR,
      });
    }
    return {
      orderId: created.id,
      productId: product.id,
      user,
      customer: { type: OrderActorType.USER, id: user.id },
    };
  }

  it('confirms PENDING_REVIEW and sets confirmedAt once', async () => {
    const { orderId } = await seedReservedPending();
    const deliveryAt = new Date('2026-08-25T09:00:00.000Z');

    const result = await transitions.confirmOrder({
      orderId,
      actor: admin,
      deliveryAt,
    });

    expect(result.replay).toBe(false);
    expect(result.order.status).toBe(OrderStatus.CONFIRMED);
    expect(result.order.confirmedAt).toBeInstanceOf(Date);
    expect(
      await prisma.outboxEvent.count({
        where: { eventType: 'order.status.changed' },
      }),
    ).toBe(1);
    expect(
      await prisma.notification.count({
        where: { userId: result.order.userId, type: 'ORDER_STATUS' },
      }),
    ).toBe(1);
    expect(result.order.deliveryAt).toEqual(deliveryAt);
  });

  it('replays confirm without rewriting timestamps or deliveryAt', async () => {
    const { orderId } = await seedReservedPending();
    const first = await transitions.confirmOrder({
      orderId,
      actor: admin,
      deliveryAt: new Date('2026-08-25T09:00:00.000Z'),
    });

    const replay = await transitions.confirmOrder({
      orderId,
      actor: admin,
      deliveryAt: new Date('2026-08-26T09:00:00.000Z'),
    });

    expect(replay.replay).toBe(true);
    expect(replay.order.confirmedAt).toEqual(first.order.confirmedAt);
    expect(
      await prisma.outboxEvent.count({
        where: { eventType: 'order.status.changed' },
      }),
    ).toBe(1);
    expect(
      await prisma.notification.count({
        where: { userId: first.order.userId, type: 'ORDER_STATUS' },
      }),
    ).toBe(1);
    expect(replay.order.deliveryAt).toEqual(first.order.deliveryAt);
  });

  it('treats 20 concurrent confirm calls as one physical update', async () => {
    const { orderId } = await seedReservedPending();

    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        transitions.confirmOrder({ orderId, actor: admin }),
      ),
    );

    expect(outcomes.every((row) => row.status === 'fulfilled')).toBe(true);
    const confirmedAtValues = new Set(
      outcomes
        .filter((row) => row.status === 'fulfilled')
        .map((row) => row.value.order.confirmedAt?.toISOString()),
    );
    expect(confirmedAtValues.size).toBe(1);
    expect(await orders.findById(orderId)).toMatchObject({
      status: OrderStatus.CONFIRMED,
    });
  });

  it('lets confirm win XOR customer cancel from PENDING_REVIEW', async () => {
    const { orderId, productId, customer } = await seedReservedPending();

    const outcomes = await Promise.allSettled([
      transitions.confirmOrder({ orderId, actor: admin }),
      transitions.cancelPendingOrderByCustomer({ orderId, actor: customer }),
    ]);

    const final = await orders.findById(orderId);
    const reservation = await prisma.inventoryReservation.findMany({
      where: { orderId },
    });
    expect(['CONFIRMED', 'CANCELLED']).toContain(final!.status);
    expect(reservation).toHaveLength(1);

    if (final!.status === OrderStatus.CONFIRMED) {
      expect(reservation[0]!.status).toBe('ACTIVE');
      expect(await inventory.getBalance(productId)).toMatchObject({
        reserved: 2,
      });
      expect(
        outcomes.some(
          (row) =>
            row.status === 'rejected' &&
            row.reason instanceof OrderInvalidTransitionError,
        ),
      ).toBe(true);
    } else {
      expect(reservation[0]!.status).toBe('RELEASED');
      expect(await inventory.getBalance(productId)).toMatchObject({
        reserved: 0,
      });
      expect(
        outcomes.some(
          (row) =>
            row.status === 'rejected' &&
            row.reason instanceof OrderInvalidTransitionError,
        ),
      ).toBe(true);
    }
  });

  it('lets confirm win XOR admin cancel from PENDING_REVIEW', async () => {
    const { orderId, productId } = await seedReservedPending();

    const outcomes = await Promise.allSettled([
      transitions.confirmOrder({ orderId, actor: admin }),
      transitions.cancelOrderByAdmin({
        orderId,
        actor: admin,
        cancelReason: 'race',
      }),
    ]);

    const final = await orders.findById(orderId);
    expect(['CONFIRMED', 'CANCELLED']).toContain(final!.status);
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { orderId },
    });
    if (final!.status === OrderStatus.CONFIRMED) {
      expect(reservation!.status).toBe('ACTIVE');
      expect(await inventory.getBalance(productId)).toMatchObject({
        reserved: 2,
      });
    } else {
      expect(reservation!.status).toBe('RELEASED');
      expect(await inventory.getBalance(productId)).toMatchObject({
        reserved: 0,
      });
    }
    expect(outcomes.some((row) => row.status === 'fulfilled')).toBe(true);
    if (final!.status === OrderStatus.CONFIRMED) {
      expect(
        outcomes.some(
          (row) =>
            row.status === 'rejected' &&
            row.reason instanceof OrderInvalidTransitionError,
        ),
      ).toBe(true);
    }
  });

  it('admin-cancels CONFIRMED and releases inventory in one commit', async () => {
    const { orderId, productId } = await seedReservedPending();
    await transitions.confirmOrder({ orderId, actor: admin });

    const result = await transitions.cancelOrderByAdmin({
      orderId,
      actor: admin,
      cancelReason: 'warehouse issue',
    });

    expect(result.order.status).toBe(OrderStatus.CANCELLED);
    expect(result.order.cancelReason).toBe('warehouse issue');
    expect(result.order.confirmedAt).not.toBeNull();
    expect(
      await prisma.inventoryReservation.findFirst({ where: { orderId } }),
    ).toMatchObject({ status: 'RELEASED' });
    expect(await inventory.getBalance(productId)).toMatchObject({
      onHand: 10,
      reserved: 0,
    });
    expect(
      await prisma.inventoryLedger.count({
        where: { referenceId: orderId, type: 'RELEASE' },
      }),
    ).toBe(1);
  });

  it('rolls back admin cancel when Inventory release fails', async () => {
    const { orderId } = await seedReservedPending({ reserve: false });

    await expect(
      transitions.cancelOrderByAdmin({
        orderId,
        actor: admin,
        cancelReason: 'no stock hold',
      }),
    ).rejects.toBeInstanceOf(InventoryReservationNotFoundError);

    expect(await orders.findById(orderId)).toMatchObject({
      status: OrderStatus.PENDING_REVIEW,
      cancelledAt: null,
    });
  });

  it('maps customer-cancel inventory failures and leaves the order pending', async () => {
    const { orderId, customer } = await seedReservedPending({ reserve: false });

    await expect(
      transitions.cancelPendingOrderByCustomer({ orderId, actor: customer }),
    ).rejects.toMatchObject({
      code: 'ORDER_INVALID_TRANSITION',
      message: OrderMessage.CUSTOMER_CANCEL_DENIED,
    });

    expect(await orders.findById(orderId)).toMatchObject({
      status: OrderStatus.PENDING_REVIEW,
    });
  });

  it('returns ORDER_NOT_FOUND when another customer cancels a pending order', async () => {
    const { orderId, productId, user } = await seedReservedPending();
    const other = await users.create({ phone: nextPhone() });

    await expect(
      transitions.cancelPendingOrderByCustomer({
        orderId,
        actor: { type: OrderActorType.USER, id: other.id },
      }),
    ).rejects.toBeInstanceOf(OrderNotFoundError);

    expect(await orders.findById(orderId)).toMatchObject({
      status: OrderStatus.PENDING_REVIEW,
      userId: user.id,
    });
    expect(
      await prisma.inventoryReservation.findFirst({ where: { orderId } }),
    ).toMatchObject({ status: 'ACTIVE' });
    expect(await inventory.getBalance(productId)).toMatchObject({
      reserved: 2,
    });
  });

  it('treats 20 concurrent same-order cancellations as one physical update', async () => {
    const { orderId, productId, customer } = await seedReservedPending();

    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        transitions.cancelPendingOrderByCustomer({
          orderId,
          actor: customer,
        }),
      ),
    );

    expect(outcomes.every((row) => row.status === 'fulfilled')).toBe(true);
    const final = await orders.findById(orderId);
    expect(final!.status).toBe(OrderStatus.CANCELLED);
    const cancelledAtValues = new Set(
      outcomes
        .filter((row) => row.status === 'fulfilled')
        .map((row) => row.value.order.cancelledAt?.toISOString()),
    );
    expect(cancelledAtValues.size).toBe(1);
    expect(await inventory.getBalance(productId)).toMatchObject({
      reserved: 0,
    });
    expect(
      await prisma.inventoryLedger.count({
        where: { referenceId: orderId, type: 'RELEASE' },
      }),
    ).toBe(1);
  });

  it('ships CONFIRMED with Inventory in one commit', async () => {
    const { orderId, productId } = await seedReservedPending();
    await transitions.confirmOrder({ orderId, actor: admin });

    const result = await transitions.shipOrder({ orderId, actor: admin });

    expect(result.order.status).toBe(OrderStatus.SHIPPED);
    expect(result.order.shippedAt).toBeInstanceOf(Date);
    expect(await inventory.getBalance(productId)).toMatchObject({
      onHand: 8,
      reserved: 0,
    });
    expect(
      await prisma.inventoryReservation.findFirst({ where: { orderId } }),
    ).toMatchObject({ status: 'SHIPPED' });
    expect(
      await prisma.inventoryLedger.findFirst({
        where: { referenceId: orderId, type: 'SHIP' },
      }),
    ).toMatchObject({ actorType: 'ADMIN', actorId: admin.id });
  });

  it('rolls back ship when Inventory fails and allows a later retry', async () => {
    const { orderId, productId } = await seedReservedPending({
      reserve: false,
    });
    await transitions.confirmOrder({ orderId, actor: admin });

    await expect(
      transitions.shipOrder({ orderId, actor: admin }),
    ).rejects.toBeInstanceOf(InventoryReservationNotFoundError);

    expect(await orders.findById(orderId)).toMatchObject({
      status: OrderStatus.CONFIRMED,
      shippedAt: null,
    });

    await inventory.reserveForOrder({
      orderId,
      lines: [{ productId, quantity: 2 }],
      actor: SYSTEM_ACTOR,
    });
    const retried = await transitions.shipOrder({ orderId, actor: admin });
    expect(retried.order.status).toBe(OrderStatus.SHIPPED);
  });

  it('lets ship XOR admin cancel from CONFIRMED', async () => {
    const { orderId, productId } = await seedReservedPending();
    await transitions.confirmOrder({ orderId, actor: admin });

    const outcomes = await Promise.allSettled([
      transitions.shipOrder({ orderId, actor: admin }),
      transitions.cancelOrderByAdmin({
        orderId,
        actor: admin,
        cancelReason: 'stop ship',
      }),
    ]);

    const final = await orders.findById(orderId);
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { orderId },
    });
    expect(['SHIPPED', 'CANCELLED']).toContain(final!.status);

    if (final!.status === OrderStatus.SHIPPED) {
      expect(reservation!.status).toBe('SHIPPED');
      expect(await inventory.getBalance(productId)).toMatchObject({
        onHand: 8,
        reserved: 0,
      });
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
    } else {
      expect(reservation!.status).toBe('RELEASED');
      expect(await inventory.getBalance(productId)).toMatchObject({
        onHand: 10,
        reserved: 0,
      });
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
    }

    expect(
      outcomes.some(
        (row) =>
          row.status === 'rejected' &&
          row.reason instanceof OrderInvalidTransitionError,
      ),
    ).toBe(true);
  });

  it('treats 20 concurrent ship calls as one Order update and one Inventory ship', async () => {
    const { orderId, productId } = await seedReservedPending();
    await transitions.confirmOrder({ orderId, actor: admin });

    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        transitions.shipOrder({ orderId, actor: admin }),
      ),
    );

    expect(outcomes.every((row) => row.status === 'fulfilled')).toBe(true);
    const shippedAtValues = new Set(
      outcomes
        .filter((row) => row.status === 'fulfilled')
        .map((row) => row.value.order.shippedAt?.toISOString()),
    );
    expect(shippedAtValues.size).toBe(1);
    expect(await inventory.getBalance(productId)).toMatchObject({
      onHand: 8,
      reserved: 0,
    });
    expect(
      await prisma.inventoryLedger.count({
        where: { referenceId: orderId, type: 'SHIP' },
      }),
    ).toBe(1);
  });

  it('delivers SHIPPED and preserves timestamps on replay', async () => {
    const { orderId } = await seedReservedPending();
    await transitions.confirmOrder({ orderId, actor: admin });
    await transitions.shipOrder({ orderId, actor: admin });

    const first = await transitions.deliverOrder({ orderId, actor: admin });
    const replay = await transitions.deliverOrder({ orderId, actor: admin });

    expect(first.order.status).toBe(OrderStatus.DELIVERED);
    expect(first.order.confirmedAt).not.toBeNull();
    expect(first.order.shippedAt).not.toBeNull();
    expect(replay.replay).toBe(true);
    expect(replay.order.deliveredAt).toEqual(first.order.deliveredAt);
    expect(replay.order.shippedAt).toEqual(first.order.shippedAt);
  });

  it('treats 20 concurrent deliver calls as one physical update', async () => {
    const { orderId } = await seedReservedPending();
    await transitions.confirmOrder({ orderId, actor: admin });
    await transitions.shipOrder({ orderId, actor: admin });

    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        transitions.deliverOrder({ orderId, actor: admin }),
      ),
    );

    expect(outcomes.every((row) => row.status === 'fulfilled')).toBe(true);
    const deliveredAtValues = new Set(
      outcomes
        .filter((row) => row.status === 'fulfilled')
        .map((row) => row.value.order.deliveredAt?.toISOString()),
    );
    expect(deliveredAtValues.size).toBe(1);
  });

  it('rolls back a joined outer transaction', async () => {
    const { orderId, productId } = await seedReservedPending();
    await transitions.confirmOrder({ orderId, actor: admin });

    await expect(
      transactions.run(async (tx) => {
        await transitions.shipOrder({ orderId, actor: admin }, tx);
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    expect(await orders.findById(orderId)).toMatchObject({
      status: OrderStatus.CONFIRMED,
      shippedAt: null,
    });
    expect(await inventory.getBalance(productId)).toMatchObject({
      onHand: 10,
      reserved: 2,
    });
    expect(
      await prisma.inventoryReservation.findFirst({ where: { orderId } }),
    ).toMatchObject({ status: 'ACTIVE' });
  });

  it('rejects illegal transitions from the public commands', async () => {
    const { orderId } = await seedReservedPending();

    await expect(
      transitions.shipOrder({ orderId, actor: admin }),
    ).rejects.toBeInstanceOf(OrderInvalidTransitionError);
    await expect(
      transitions.deliverOrder({ orderId, actor: admin }),
    ).rejects.toBeInstanceOf(OrderInvalidTransitionError);

    await transitions.confirmOrder({ orderId, actor: admin });
    await expect(
      transitions.deliverOrder({ orderId, actor: admin }),
    ).rejects.toBeInstanceOf(OrderInvalidTransitionError);
    await expect(
      transitions.cancelPendingOrderByCustomer({
        orderId,
        actor: {
          type: OrderActorType.USER,
          id: (await orders.findById(orderId))!.userId,
        },
      }),
    ).rejects.toMatchObject({
      message: OrderMessage.CUSTOMER_CANCEL_DENIED,
    });

    await transitions.shipOrder({ orderId, actor: admin });
    await expect(
      transitions.cancelOrderByAdmin({
        orderId,
        actor: admin,
        cancelReason: 'too late',
      }),
    ).rejects.toBeInstanceOf(OrderInvalidTransitionError);

    await transitions.deliverOrder({ orderId, actor: admin });
    await expect(
      transitions.confirmOrder({ orderId, actor: admin }),
    ).rejects.toBeInstanceOf(OrderInvalidTransitionError);
  });

  it('keeps Order and Inventory terminal states consistent', async () => {
    const { orderId, productId } = await seedReservedPending();
    await transitions.confirmOrder({ orderId, actor: admin });
    await transitions.shipOrder({ orderId, actor: admin });
    await transitions.deliverOrder({ orderId, actor: admin });

    expect(await orders.findById(orderId)).toMatchObject({
      status: OrderStatus.DELIVERED,
    });
    expect(
      await prisma.inventoryReservation.findFirst({ where: { orderId } }),
    ).toMatchObject({ status: 'SHIPPED' });
    expect(await inventory.getBalance(productId)).toMatchObject({
      onHand: 8,
      reserved: 0,
    });
  });

  it('does not block confirm when the source product is later inactive', async () => {
    const { orderId, productId } = await seedReservedPending();
    await prisma.product.update({
      where: { id: productId },
      data: { isActive: false },
    });

    const confirmed = await transitions.confirmOrder({
      orderId,
      actor: admin,
    });
    expect(confirmed.order.status).toBe(OrderStatus.CONFIRMED);
  });

  it('returns ORDER_NOT_FOUND for a missing order', async () => {
    await expect(
      transitions.confirmOrder({ orderId: randomUUID(), actor: admin }),
    ).rejects.toBeInstanceOf(OrderNotFoundError);
  });
});

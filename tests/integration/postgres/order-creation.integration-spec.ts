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
import {
  InventoryService,
  SYSTEM_ACTOR,
} from '../../../src/modules/inventory/application/inventory.service';
import { InventoryInsufficientStockError } from '../../../src/modules/inventory/domain/inventory-errors';
import { InventoryLedgerReferenceType } from '../../../src/modules/inventory/domain/inventory-ledger';
import { InventoryModule } from '../../../src/modules/inventory/inventory.module';
import { OrderCreationService } from '../../../src/modules/orders/application/order-creation.service';
import { OrderActorType } from '../../../src/modules/orders/domain/order-actor';
import {
  OrderIdempotencyConflictError,
  OrderInvalidProductError,
} from '../../../src/modules/orders/domain/order-errors';
import { OrdersModule } from '../../../src/modules/orders/orders.module';
import { DiscountService } from '../../../src/modules/pricing/application/discount.service';
import { PricingService } from '../../../src/modules/pricing/application/pricing.service';
import {
  DiscountTarget,
  DiscountType,
} from '../../../src/modules/pricing/domain/discount';
import { PriceHistoryActorType } from '../../../src/modules/pricing/domain/price-history-actor';
import { PricingModule } from '../../../src/modules/pricing/pricing.module';
import { ProductRepository } from '../../../src/modules/products/infrastructure/product.repository';
import { ProductsModule } from '../../../src/modules/products/products.module';
import { RegionRepository } from '../../../src/modules/regions/infrastructure/region.repository';
import type { UserRecord } from '../../../src/modules/users/domain/user';
import { UserRepository } from '../../../src/modules/users/infrastructure/user.repository';
import { UsersModule } from '../../../src/modules/users/users.module';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

function uniquePhone(suffix: number): string {
  const national = `912${String(suffix).padStart(7, '0')}`.slice(0, 10);
  return `+98${national}`;
}

async function truncateTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "InventoryLedger", "InventoryReservation", "Inventory", "Discount", "PriceHistory", "OrderLine", "Order", "Product", "Category", "Region", "User" RESTART IDENTITY CASCADE',
  );
}

describe('Order creation (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let users: UserRepository;
  let regions: RegionRepository;
  let categories: CategoryRepository;
  let products: ProductRepository;
  let inventory: InventoryService;
  let discounts: DiscountService;
  let pricing: PricingService;
  let creation: OrderCreationService;
  let transactions: TransactionRunner;
  let phoneCounter = 0;
  let adminActorId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        PrismaModule,
        InventoryModule,
        ProductsModule,
        PricingModule,
        UsersModule,
        OrdersModule,
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
    pricing = moduleRef.get(PricingService);
    creation = moduleRef.get(OrderCreationService);
    transactions = moduleRef.get(TransactionRunner);
    adminActorId = randomUUID();
    await app.init();
  });

  beforeEach(async () => {
    await truncateTables(prisma);
  });

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
  }): Promise<{
    user: UserRecord;
    regionId: string;
    productId: string;
    categoryId: string;
  }> {
    const user = await users.create({ phone: nextPhone() });
    const region = await regions.create({ name: `Region ${randomUUID()}` });
    const category = await categories.create({ name: `Cat ${randomUUID()}` });
    const product = await products.create({
      name: `Eggs ${randomUUID()}`,
      price: options?.price ?? 10_000,
      categoryId: category.id,
    });
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
    return {
      user,
      regionId: region.id,
      productId: product.id,
      categoryId: category.id,
    };
  }

  it('atomically creates Order + lines + ACTIVE reservation', async () => {
    const { user, regionId, productId } = await seedBase({ onHand: 10 });

    const result = await creation.createOrder({
      actor: { type: OrderActorType.USER, id: user.id },
      regionId,
      idempotencyKey: randomUUID(),
      lines: [{ productId, quantity: 3 }],
    });

    expect(result.created).toBe(true);
    expect(result.order.status).toBe('PENDING_REVIEW');
    expect(result.order.grossSubtotal).toBe(30_000n);
    expect(result.order.total).toBe(30_000n);

    const balance = await inventory.getBalance(productId);
    expect(balance).toMatchObject({ onHand: 10, reserved: 3, available: 7 });

    const reservations = await prisma.inventoryReservation.findMany({
      where: { orderId: result.order.id },
    });
    expect(reservations).toEqual([
      expect.objectContaining({
        productId,
        quantity: 3,
        status: 'ACTIVE',
      }),
    ]);
  });

  it('rolls back Order and reservation when stock is insufficient', async () => {
    const { user, regionId, productId } = await seedBase({ onHand: 1 });

    await expect(
      creation.createOrder({
        actor: { type: OrderActorType.USER, id: user.id },
        regionId,
        idempotencyKey: randomUUID(),
        lines: [{ productId, quantity: 5 }],
      }),
    ).rejects.toBeInstanceOf(InventoryInsufficientStockError);

    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.orderLine.count()).toBe(0);
    expect(await prisma.inventoryReservation.count()).toBe(0);
    expect(await inventory.getBalance(productId)).toMatchObject({
      onHand: 1,
      reserved: 0,
    });
  });

  it('replays 20 concurrent identical creates as one Order / one reservation', async () => {
    const { user, regionId, productId } = await seedBase({ onHand: 50 });
    const idempotencyKey = randomUUID();

    const settled = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        creation.createOrder({
          actor: { type: OrderActorType.USER, id: user.id },
          regionId,
          idempotencyKey,
          lines: [{ productId, quantity: 2 }],
        }),
      ),
    );

    const fulfilled = settled.filter((row) => row.status === 'fulfilled');
    expect(fulfilled).toHaveLength(20);
    const orderIds = new Set(
      fulfilled.map((row) =>
        row.status === 'fulfilled' ? row.value.order.id : '',
      ),
    );
    expect(orderIds.size).toBe(1);
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.inventoryReservation.count()).toBe(1);
    expect(await inventory.getBalance(productId)).toMatchObject({
      reserved: 2,
    });
  });

  it('same key / different payload race yields one winner and conflicts', async () => {
    const { user, regionId, productId } = await seedBase({ onHand: 50 });
    const second = await products.create({
      name: `Other ${randomUUID()}`,
      price: 8_000,
      categoryId: (await categories.create({ name: `Cat2 ${randomUUID()}` }))
        .id,
    });
    await inventory.receiveOnHand({
      productId: second.id,
      quantity: 50,
      referenceType: InventoryLedgerReferenceType.RECEIVE,
      referenceId: randomUUID(),
      actor: SYSTEM_ACTOR,
    });
    const idempotencyKey = randomUUID();

    const settled = await Promise.allSettled([
      creation.createOrder({
        actor: { type: OrderActorType.USER, id: user.id },
        regionId,
        idempotencyKey,
        lines: [{ productId, quantity: 1 }],
      }),
      creation.createOrder({
        actor: { type: OrderActorType.USER, id: user.id },
        regionId,
        idempotencyKey,
        lines: [{ productId: second.id, quantity: 1 }],
      }),
    ]);

    const fulfilled = settled.filter((row) => row.status === 'fulfilled');
    const rejected = settled.filter((row) => row.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(
      rejected[0]?.status === 'rejected' &&
        rejected[0].reason instanceof OrderIdempotencyConflictError,
    ).toBe(true);
    expect(await prisma.order.count()).toBe(1);
  });

  it('competing orders for a hot SKU respect available stock', async () => {
    const { user, regionId, productId } = await seedBase({ onHand: 5 });
    const other = await users.create({ phone: nextPhone() });

    const settled = await Promise.allSettled([
      creation.createOrder({
        actor: { type: OrderActorType.USER, id: user.id },
        regionId,
        idempotencyKey: randomUUID(),
        lines: [{ productId, quantity: 4 }],
      }),
      creation.createOrder({
        actor: { type: OrderActorType.USER, id: other.id },
        regionId,
        idempotencyKey: randomUUID(),
        lines: [{ productId, quantity: 4 }],
      }),
    ]);

    const ok = settled.filter((row) => row.status === 'fulfilled');
    const fail = settled.filter((row) => row.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(fail).toHaveLength(1);
    expect(
      fail[0]?.status === 'rejected' &&
        fail[0].reason instanceof InventoryInsufficientStockError,
    ).toBe(true);
    expect(await prisma.order.count()).toBe(1);
    expect(await inventory.getBalance(productId)).toMatchObject({
      onHand: 5,
      reserved: 4,
    });
  });

  it('opens create work through TransactionRunner.runRepeatableRead', async () => {
    const { user, regionId, productId } = await seedBase();
    const spy = jest.spyOn(transactions, 'runRepeatableRead');

    await creation.createOrder({
      actor: { type: OrderActorType.USER, id: user.id },
      regionId,
      idempotencyKey: randomUUID(),
      lines: [{ productId, quantity: 1 }],
    });

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('persists a coherent price snapshot under concurrent Product price update', async () => {
    const { user, regionId, productId } = await seedBase({ price: 10_000 });

    const createPromise = creation.createOrder({
      actor: { type: OrderActorType.USER, id: user.id },
      regionId,
      idempotencyKey: randomUUID(),
      lines: [{ productId, quantity: 2 }],
    });

    await pricing.changeProductPrice({
      productId,
      newPrice: 12_000,
      actor: {
        type: PriceHistoryActorType.ADMIN,
        id: adminActorId,
      },
    });

    const result = await createPromise;
    const unit = result.order.lines[0]!.unitPrice;
    expect([10_000, 12_000]).toContain(unit);
    expect(result.order.lines[0]!.grossLineTotal).toBe(BigInt(unit * 2));
    expect(result.order.total).toBe(result.order.lines[0]!.finalLineTotal);
  });

  it('persists a coherent discount snapshot under concurrent Discount update', async () => {
    const { user, regionId, productId } = await seedBase({ price: 10_000 });
    const discount = await discounts.create({
      name: 'Line 10%',
      type: DiscountType.PERCENT,
      target: DiscountTarget.PRODUCT,
      percentValue: 10,
      productId,
      precedence: 10,
    });

    const createPromise = creation.createOrder({
      actor: { type: OrderActorType.USER, id: user.id },
      regionId,
      idempotencyKey: randomUUID(),
      lines: [{ productId, quantity: 1 }],
    });

    await discounts.deactivate(discount.id);
    const result = await createPromise;

    expect([9_000n, 10_000n]).toContain(result.order.total);
    if (result.order.total === 9_000n) {
      expect(result.order.lines[0]!.appliedLineDiscount?.discountId).toBe(
        discount.id,
      );
    } else {
      expect(result.order.lines[0]!.appliedLineDiscount).toBeNull();
    }
  });

  it('keeps historical snapshots after Product/Discount mutate post-commit', async () => {
    const { user, regionId, productId, categoryId } = await seedBase({
      price: 10_000,
    });
    const discount = await discounts.create({
      name: 'Line 10%',
      type: DiscountType.PERCENT,
      target: DiscountTarget.PRODUCT,
      percentValue: 10,
      productId,
      precedence: 10,
    });

    const result = await creation.createOrder({
      actor: { type: OrderActorType.USER, id: user.id },
      regionId,
      idempotencyKey: randomUUID(),
      lines: [{ productId, quantity: 2 }],
    });

    await pricing.changeProductPrice({
      productId,
      newPrice: 50_000,
      actor: {
        type: PriceHistoryActorType.ADMIN,
        id: adminActorId,
      },
    });
    await discounts.deactivate(discount.id);
    await products.update(productId, { name: 'Renamed', isActive: false });
    void categoryId;

    const reloaded = await prisma.order.findUnique({
      where: { id: result.order.id },
      include: { lines: true },
    });
    expect(reloaded?.total).toBe(result.order.total);
    expect(reloaded?.lines[0]?.unitPrice).toBe(10_000);
    expect(reloaded?.lines[0]?.productName).not.toBe('Renamed');
    expect(reloaded?.lines[0]?.lineDiscountAmount).toBe(2_000n);
  });

  it('rejects inactive/hidden products without persisting an Order', async () => {
    const { user, regionId, productId } = await seedBase();
    await products.update(productId, { isActive: false });

    await expect(
      creation.createOrder({
        actor: { type: OrderActorType.USER, id: user.id },
        regionId,
        idempotencyKey: randomUUID(),
        lines: [{ productId, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(OrderInvalidProductError);

    expect(await prisma.order.count()).toBe(0);
  });

  it('persists LINE + ORDER discount composition and one pricingEvaluatedAt', async () => {
    const { user, regionId, productId, categoryId } = await seedBase({
      price: 10_000,
    });
    await discounts.create({
      name: 'Line 10%',
      type: DiscountType.PERCENT,
      target: DiscountTarget.PRODUCT,
      percentValue: 10,
      productId,
      precedence: 10,
    });
    await discounts.create({
      name: 'Order 10%',
      type: DiscountType.PERCENT,
      target: DiscountTarget.ORDER,
      percentValue: 10,
      precedence: 5,
    });
    void categoryId;

    const result = await creation.createOrder({
      actor: { type: OrderActorType.USER, id: user.id },
      regionId,
      idempotencyKey: randomUUID(),
      lines: [{ productId, quantity: 2 }],
    });

    // 20_000 - 10% line = 18_000; then 10% order = 16_200
    expect(result.order.grossSubtotal).toBe(20_000n);
    expect(result.order.lineDiscountTotal).toBe(2_000n);
    expect(result.order.subtotalAfterLineDiscounts).toBe(18_000n);
    expect(result.order.orderDiscountAmount).toBe(1_800n);
    expect(result.order.total).toBe(16_200n);
    expect(result.order.appliedOrderDiscount).not.toBeNull();
    expect(result.order.lines[0]!.appliedLineDiscount).not.toBeNull();
    expect(result.order.pricingEvaluatedAt).toBeInstanceOf(Date);
  });
});

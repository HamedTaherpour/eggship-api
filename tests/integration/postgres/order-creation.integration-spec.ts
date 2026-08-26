import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdminRole } from '../../../src/common/authz/admin-role';
import { postgresIntegrationImports } from '../support/postgres-testing-module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import {
  TRANSACTION_CONTEXT_BRAND,
  TransactionRunner,
} from '../../../src/infrastructure/database/transaction';
import { CategoryRepository } from '../../../src/modules/categories/infrastructure/category.repository';
import { CommercePolicyService } from '../../../src/modules/commerce-policy/application/commerce-policy.service';
import { CommercePolicyModule } from '../../../src/modules/commerce-policy/commerce-policy.module';
import { CommerceOverrideMode } from '../../../src/modules/commerce-policy/domain/commerce-policy';
import { toTehranLocalWallClock } from '../../../src/modules/commerce-policy/domain/order-acceptance';
import {
  OrderingClosedError,
  OrderingPolicyUnavailableError,
  OrderMinimumQuantityNotMetError,
} from '../../../src/modules/commerce-policy/domain/commerce-policy-errors';
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
    'TRUNCATE TABLE "DiscountUsageRecord", "DiscountCustomerUsage", "InventoryLedger", "InventoryReservation", "Inventory", "Discount", "PriceHistory", "OrderLine", "Order", "Product", "Category", "Region", "User", "CommerceScheduleOverride", "CommerceSettings" RESTART IDENTITY CASCADE',
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
  let commercePolicy: CommercePolicyService;
  let transactions: TransactionRunner;
  let phoneCounter = 0;
  let adminActorId: string;

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
    pricing = moduleRef.get(PricingService);
    creation = moduleRef.get(OrderCreationService);
    commercePolicy = moduleRef.get(CommercePolicyService);
    transactions = moduleRef.get(TransactionRunner);
    await app.init();
  });

  beforeEach(async () => {
    await truncateTables(prisma);
    const admin = await prisma.admin.upsert({
      where: { email: 'order-create-integration@example.test' },
      update: { isActive: true, role: AdminRole.SUPER_ADMIN },
      create: {
        email: 'order-create-integration@example.test',
        passwordHash: 'integration-placeholder-hash',
        role: AdminRole.SUPER_ADMIN,
      },
    });
    adminActorId = admin.id;
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
    const rejected = settled.filter((row) => row.status === 'rejected');
    expect(fulfilled).toHaveLength(20);
    expect(rejected).toHaveLength(0);
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
  }, 30_000);

  it('same key / different payload race yields one winner and conflicts', async () => {
    const { user, regionId, productId } = await seedBase({ onHand: 50 });
    const second = await products.create({
      name: `Other ${randomUUID()}`,
      price: 8_000,
      categoryId: (await categories.create({ name: `Cat2 ${randomUUID()}` }))
        .id,
    });
    await inventory.ensureForProduct(second.id);
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
      rejected[0]?.status === 'rejected' ? rejected[0].reason : null,
    ).toBeInstanceOf(OrderIdempotencyConflictError);
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
    expect(result.order.commercePolicyRevision).toBe(1);
  });

  it('rejects when commerce policy is absent (fail closed) with no side effects', async () => {
    assertDestructiveOperationsAllowed();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "CommerceScheduleOverride", "CommerceSettings" RESTART IDENTITY CASCADE',
    );
    const { user, regionId, productId } = await seedBase({ onHand: 10 });

    await expect(
      creation.createOrder({
        actor: { type: OrderActorType.USER, id: user.id },
        regionId,
        idempotencyKey: randomUUID(),
        lines: [{ productId, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(OrderingPolicyUnavailableError);

    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.inventoryReservation.count()).toBe(0);
    expect(await inventory.getBalance(productId)).toMatchObject({
      reserved: 0,
    });
  });

  it('rejects CLOSED overrides and below-minimum carts without Order/Inventory mutations', async () => {
    const { user, regionId, productId } = await seedBase({ onHand: 10 });
    const wall = await prisma.$queryRaw<Array<{ now: Date }>>`
      SELECT CURRENT_TIMESTAMP AS "now"
    `;
    const { localDate } = toTehranLocalWallClock(wall[0]!.now);

    await commercePolicy.putOverride(
      localDate,
      {
        mode: CommerceOverrideMode.CLOSED,
        opensAtLocalMinute: null,
        closesAtLocalMinute: null,
      },
      1,
      adminActorId,
    );

    await expect(
      creation.createOrder({
        actor: { type: OrderActorType.USER, id: user.id },
        regionId,
        idempotencyKey: randomUUID(),
        lines: [{ productId, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(OrderingClosedError);

    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.inventoryReservation.count()).toBe(0);

    await commercePolicy.removeOverride(localDate, 2, adminActorId);
    await commercePolicy.update(
      {
        orderingScheduleEnabled: false,
        orderingOpensAtLocalMinute: 7 * 60,
        orderingClosesAtLocalMinute: 16 * 60,
        minimumOrderQuantity: 5,
      },
      3,
      adminActorId,
    );

    await expect(
      creation.createOrder({
        actor: { type: OrderActorType.USER, id: user.id },
        regionId,
        idempotencyKey: randomUUID(),
        lines: [{ productId, quantity: 2 }],
      }),
    ).rejects.toBeInstanceOf(OrderMinimumQuantityNotMetError);
    expect(await prisma.order.count()).toBe(0);
  });

  it('allows a later success with the same idempotency key after a policy rejection', async () => {
    const { user, regionId, productId } = await seedBase({ onHand: 10 });
    const idempotencyKey = randomUUID();

    await commercePolicy.update(
      {
        orderingScheduleEnabled: false,
        orderingOpensAtLocalMinute: 7 * 60,
        orderingClosesAtLocalMinute: 16 * 60,
        minimumOrderQuantity: 5,
      },
      1,
      adminActorId,
    );

    await expect(
      creation.createOrder({
        actor: { type: OrderActorType.USER, id: user.id },
        regionId,
        idempotencyKey,
        lines: [{ productId, quantity: 2 }],
      }),
    ).rejects.toBeInstanceOf(OrderMinimumQuantityNotMetError);

    expect(await prisma.order.count()).toBe(0);

    await commercePolicy.update(
      {
        orderingScheduleEnabled: false,
        orderingOpensAtLocalMinute: 7 * 60,
        orderingClosesAtLocalMinute: 16 * 60,
        minimumOrderQuantity: 1,
      },
      2,
      adminActorId,
    );

    const result = await creation.createOrder({
      actor: { type: OrderActorType.USER, id: user.id },
      regionId,
      idempotencyKey,
      lines: [{ productId, quantity: 2 }],
    });

    expect(result.created).toBe(true);
    expect(result.order.commercePolicyRevision).toBe(3);
    expect(await prisma.order.count()).toBe(1);
  });

  it('reads User and Region through the outer RR TransactionContext (ORD-03A)', async () => {
    const { user, regionId, productId } = await seedBase({ onHand: 5 });
    const userSpy = jest.spyOn(users, 'findById');
    const regionSpy = jest.spyOn(regions, 'findById');

    try {
      await creation.createOrder({
        actor: { type: OrderActorType.USER, id: user.id },
        regionId,
        idempotencyKey: randomUUID(),
        lines: [{ productId, quantity: 1 }],
      });

      expect(userSpy).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({ [TRANSACTION_CONTEXT_BRAND]: true }),
      );
      expect(regionSpy).toHaveBeenCalledWith(
        regionId,
        expect.objectContaining({ [TRANSACTION_CONTEXT_BRAND]: true }),
      );
    } finally {
      userSpy.mockRestore();
      regionSpy.mockRestore();
    }
  });

  it('createOrder persists Region name from joined RR read despite concurrent rename', async () => {
    const { user, regionId, productId } = await seedBase({ onHand: 5 });
    const original = await regions.findById(regionId);
    expect(original).not.toBeNull();

    const realFindById = regions.findById.bind(regions);
    const spy = jest
      .spyOn(regions, 'findById')
      .mockImplementation(async (id, tx?) => {
        const row = await realFindById(id, tx);
        if (tx !== undefined && id === regionId && row !== null) {
          await prisma.region.update({
            where: { id: regionId },
            data: { name: `Renamed ${randomUUID()}` },
          });
        }
        return row;
      });

    try {
      const result = await creation.createOrder({
        actor: { type: OrderActorType.USER, id: user.id },
        regionId,
        idempotencyKey: randomUUID(),
        lines: [{ productId, quantity: 1 }],
      });
      expect(result.order.regionName).toBe(original!.name);
      const outside = await realFindById(regionId);
      expect(outside?.name).not.toBe(original!.name);
    } finally {
      spy.mockRestore();
    }
  });

  it('createOrder accepts User that was active in the RR snapshot after concurrent disable', async () => {
    const { user, regionId, productId } = await seedBase({ onHand: 5 });
    const realFindById = users.findById.bind(users);
    const spy = jest
      .spyOn(users, 'findById')
      .mockImplementation(async (id, tx?) => {
        const row = await realFindById(id, tx);
        if (tx !== undefined && id === user.id && row !== null) {
          await prisma.user.update({
            where: { id: user.id },
            data: { isActive: false },
          });
        }
        return row;
      });

    try {
      const result = await creation.createOrder({
        actor: { type: OrderActorType.USER, id: user.id },
        regionId,
        idempotencyKey: randomUUID(),
        lines: [{ productId, quantity: 1 }],
      });
      expect(result.created).toBe(true);
      expect(result.order.customerPhone).toBe(user.phone);
      const outside = await realFindById(user.id);
      expect(outside?.isActive).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('User and Region TransactionContext reads stay on the RR snapshot', async () => {
    const user = await users.create({ phone: nextPhone() });
    const region = await regions.create({ name: 'Snapshot Region' });

    await transactions.runRepeatableRead(async (tx) => {
      const userSnap = await users.findById(user.id, tx);
      const regionSnap = await regions.findById(region.id, tx);
      expect(userSnap?.isActive).toBe(true);
      expect(regionSnap?.name).toBe('Snapshot Region');

      await prisma.user.update({
        where: { id: user.id },
        data: { isActive: false },
      });
      await regions.update(region.id, { name: 'Renamed Outside Snapshot' });

      const userViaTx = await users.findById(user.id, tx);
      const regionViaTx = await regions.findById(region.id, tx);
      const userOutside = await users.findById(user.id);
      const regionOutside = await regions.findById(region.id);

      expect(userViaTx?.isActive).toBe(true);
      expect(regionViaTx?.name).toBe('Snapshot Region');
      expect(userOutside?.isActive).toBe(false);
      expect(regionOutside?.name).toBe('Renamed Outside Snapshot');
    });
  });
});

import type { TransactionContext } from '../../../infrastructure/database/transaction';
import {
  TransactionRunner,
  TRANSACTION_CONTEXT_BRAND,
} from '../../../infrastructure/database/transaction';
import type { ProductRecord } from '../../products/domain/product';
import type { ProductRepository } from '../../products/infrastructure/product.repository';
import type { DiscountRecord } from '../domain/discount';
import { DiscountTarget, DiscountType } from '../domain/discount';
import { OrderPricingProductUnavailableError } from '../domain/order-pricing-errors';
import type { DiscountRepository } from '../infrastructure/discount.repository';
import { OrderPricingService } from './order-pricing.service';

const PRODUCT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRODUCT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CATEGORY_EGGS = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const evaluatedAt = new Date('2026-08-15T12:00:00.000Z');

const fakeTx = { [TRANSACTION_CONTEXT_BRAND]: true as const };

class ImmediateTransactionRunner extends TransactionRunner {
  snapshotReadCalls = 0;
  runInCalls = 0;

  override run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return fn(fakeTx);
  }

  override runIn<T>(
    existing: TransactionContext | undefined,
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    this.runInCalls += 1;
    return fn(existing ?? fakeTx);
  }

  override runSnapshotRead<T>(
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    this.snapshotReadCalls += 1;
    return fn(fakeTx);
  }
}

function product(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id: overrides.id ?? PRODUCT_A,
    name: overrides.name ?? 'Fresh eggs',
    price: overrides.price ?? 10_000,
    categoryId: overrides.categoryId ?? CATEGORY_EGGS,
    isActive: overrides.isActive ?? true,
    createdAt: overrides.createdAt ?? new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-08-01T00:00:00.000Z'),
  };
}

function discount(overrides: Partial<DiscountRecord> = {}): DiscountRecord {
  return {
    id: overrides.id ?? '33333333-3333-4333-8333-333333333333',
    name: overrides.name ?? 'Order 10%',
    type: overrides.type ?? DiscountType.PERCENT,
    target: overrides.target ?? DiscountTarget.ORDER,
    percentValue: overrides.percentValue ?? 10,
    fixedAmount: overrides.fixedAmount ?? null,
    productId: overrides.productId ?? null,
    categoryId: overrides.categoryId ?? null,
    isActive: overrides.isActive ?? true,
    startsAt: overrides.startsAt ?? null,
    endsAt: overrides.endsAt ?? null,
    precedence: overrides.precedence ?? 0,
    createdAt: overrides.createdAt ?? new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-08-01T00:00:00.000Z'),
  };
}

describe('OrderPricingService', () => {
  let products: jest.Mocked<Pick<ProductRepository, 'findPublicByIds'>>;
  let discounts: jest.Mocked<
    Pick<DiscountRepository, 'findCandidatesForOrderPricing'>
  >;
  let transactions: ImmediateTransactionRunner;
  let service: OrderPricingService;

  beforeEach(() => {
    products = {
      findPublicByIds: jest.fn(),
    };
    discounts = {
      findCandidatesForOrderPricing: jest.fn().mockResolvedValue([]),
    };
    transactions = new ImmediateTransactionRunner();
    service = new OrderPricingService(
      products as unknown as ProductRepository,
      discounts as unknown as DiscountRepository,
      transactions,
    );
  });

  it('loads products and discounts once then composes pricing', async () => {
    products.findPublicByIds.mockResolvedValue([
      product({ id: PRODUCT_A, price: 10_000 }),
      product({ id: PRODUCT_B, name: 'B', price: 5_000 }),
    ]);
    discounts.findCandidatesForOrderPricing.mockResolvedValue([
      discount({
        target: DiscountTarget.PRODUCT,
        type: DiscountType.FIXED,
        percentValue: null,
        fixedAmount: 500,
        productId: PRODUCT_A,
      }),
      discount(),
    ]);

    const result = await service.priceOrderLines(
      [
        { productId: PRODUCT_A, quantity: 2 },
        { productId: PRODUCT_B, quantity: 1 },
      ],
      { evaluatedAt },
    );

    expect(transactions.snapshotReadCalls).toBe(1);
    expect(products.findPublicByIds).toHaveBeenCalledTimes(1);
    expect(discounts.findCandidatesForOrderPricing).toHaveBeenCalledTimes(1);
    expect(discounts.findCandidatesForOrderPricing).toHaveBeenCalledWith(
      {
        productIds: [PRODUCT_A, PRODUCT_B],
        categoryIds: [CATEGORY_EGGS],
      },
      fakeTx,
    );

    // A: 20_000 − 500 = 19_500; B: 5_000; subtotal 24_500 − 10% = 22_050
    expect(result.grossSubtotal).toBe(25_000n);
    expect(result.subtotalAfterLineDiscounts).toBe(24_500n);
    expect(result.orderDiscountAmount).toBe(2_450n);
    expect(result.total).toBe(22_050n);
    expect(result.evaluatedAt).toBe(evaluatedAt);
  });

  it('joins an outer transaction without starting a snapshot read', async () => {
    products.findPublicByIds.mockResolvedValue([product()]);
    const outerTx = { [TRANSACTION_CONTEXT_BRAND]: true as const };

    await service.priceOrderLines([{ productId: PRODUCT_A, quantity: 1 }], {
      evaluatedAt,
      tx: outerTx,
    });

    expect(transactions.snapshotReadCalls).toBe(0);
    expect(transactions.runInCalls).toBe(1);
    expect(products.findPublicByIds).toHaveBeenCalledWith([PRODUCT_A], outerTx);
  });

  it('rejects missing or non-public products with PRODUCT_NOT_FOUND', async () => {
    products.findPublicByIds.mockResolvedValue([]);

    await expect(
      service.priceOrderLines([{ productId: PRODUCT_A, quantity: 1 }], {
        evaluatedAt,
      }),
    ).rejects.toMatchObject({
      code: 'PRODUCT_NOT_FOUND',
      name: 'OrderPricingProductUnavailableError',
    });
    await expect(
      service.priceOrderLines([{ productId: PRODUCT_A, quantity: 1 }], {
        evaluatedAt,
      }),
    ).rejects.toBeInstanceOf(OrderPricingProductUnavailableError);
  });

  it('collapses duplicate product ids before loading', async () => {
    products.findPublicByIds.mockResolvedValue([product({ price: 1_000 })]);

    const result = await service.priceOrderLines(
      [
        { productId: PRODUCT_A, quantity: 2 },
        { productId: PRODUCT_A, quantity: 3 },
      ],
      { evaluatedAt },
    );

    expect(products.findPublicByIds).toHaveBeenCalledWith([PRODUCT_A], fakeTx);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.quantity).toBe(5);
    expect(result.grossSubtotal).toBe(5_000n);
  });

  it('snapshots server product name/price/category, not client authority', async () => {
    products.findPublicByIds.mockResolvedValue([
      product({
        name: 'Server name',
        price: 42_000,
        categoryId: CATEGORY_EGGS,
      }),
    ]);

    const result = await service.priceOrderLines(
      [{ productId: PRODUCT_A, quantity: 1 }],
      { evaluatedAt },
    );

    expect(result.lines[0]).toMatchObject({
      productName: 'Server name',
      unitPrice: 42_000,
      categoryId: CATEGORY_EGGS,
    });
  });
});

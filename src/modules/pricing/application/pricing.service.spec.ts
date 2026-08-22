import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import {
  TRANSACTION_CONTEXT_BRAND,
  TransactionRunner,
} from '../../../infrastructure/database/transaction';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import { AuthSubjectType } from '../../auth/domain/subject-type';
import type { ProductRecord } from '../../products/domain/product';
import { ProductNotFoundError } from '../../products/domain/product-errors';
import type { ProductRepository } from '../../products/infrastructure/product.repository';
import { PriceHistoryActorType } from '../domain/price-history-actor';
import { PricingAdminRequiredError } from '../domain/pricing-errors';
import type { PriceHistoryRepository } from '../infrastructure/price-history.repository';
import { PricingService } from './pricing.service';

class ImmediateTransactionRunner extends TransactionRunner {
  override run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return fn({ [TRANSACTION_CONTEXT_BRAND]: true });
  }

  override runIn<T>(
    existing: TransactionContext | undefined,
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return fn(existing ?? { [TRANSACTION_CONTEXT_BRAND]: true });
  }

  override runSnapshotRead<T>(
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return this.run(fn);
  }
}

const PRODUCT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const adminPrincipal: AuthenticatedPrincipal = {
  subjectId: ADMIN_ID,
  subjectType: AuthSubjectType.ADMIN,
  sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};

function product(overrides: Partial<ProductRecord> = {}): ProductRecord {
  const now = new Date('2026-08-22T12:00:00.000Z');
  return {
    id: PRODUCT_ID,
    name: 'Eggs',
    price: 625000,
    categoryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('PricingService', () => {
  let products: jest.Mocked<
    Pick<ProductRepository, 'findByIdForUpdate' | 'updatePrice'>
  >;
  let priceHistory: jest.Mocked<Pick<PriceHistoryRepository, 'append'>>;
  let logger: jest.Mocked<Pick<ApplicationLogger, 'info'>>;
  let service: PricingService;

  beforeEach(() => {
    products = {
      findByIdForUpdate: jest.fn(),
      updatePrice: jest.fn(),
    };
    priceHistory = { append: jest.fn() };
    logger = { info: jest.fn() };
    service = new PricingService(
      products as unknown as ProductRepository,
      priceHistory as unknown as PriceHistoryRepository,
      new ImmediateTransactionRunner(),
      logger as unknown as ApplicationLogger,
    );
  });

  it('writes exactly one history row on the first price change with server-read oldPrice', async () => {
    const current = product();
    const updated = product({ price: 650000 });
    products.findByIdForUpdate.mockResolvedValue(current);
    products.updatePrice.mockResolvedValue(updated);
    priceHistory.append.mockResolvedValue({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      productId: PRODUCT_ID,
      oldPrice: 625000,
      newPrice: 650000,
      actorType: PriceHistoryActorType.ADMIN,
      actorId: ADMIN_ID,
      createdAt: new Date(),
    });

    const result = await service.changeProductPrice({
      productId: PRODUCT_ID,
      newPrice: 650000,
      actor: { type: PriceHistoryActorType.ADMIN, id: ADMIN_ID },
    });

    expect(result.historyWritten).toBe(true);
    expect(result.product.price).toBe(650000);
    expect(priceHistory.append).toHaveBeenCalledWith(
      {
        productId: PRODUCT_ID,
        oldPrice: 625000,
        newPrice: 650000,
        actorType: PriceHistoryActorType.ADMIN,
        actorId: ADMIN_ID,
      },
      expect.anything(),
    );
  });

  it('skips history for a no-op price update', async () => {
    products.findByIdForUpdate.mockResolvedValue(product());

    const result = await service.changeProductPrice({
      productId: PRODUCT_ID,
      newPrice: 625000,
      actor: { type: PriceHistoryActorType.ADMIN, id: ADMIN_ID },
    });

    expect(result.historyWritten).toBe(false);
    expect(products.updatePrice).not.toHaveBeenCalled();
    expect(priceHistory.append).not.toHaveBeenCalled();
  });

  it('throws PRODUCT_NOT_FOUND when the product does not exist', async () => {
    products.findByIdForUpdate.mockResolvedValue(null);

    await expect(
      service.changeProductPrice({
        productId: PRODUCT_ID,
        newPrice: 650000,
        actor: { type: PriceHistoryActorType.ADMIN, id: ADMIN_ID },
      }),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
    expect(priceHistory.append).not.toHaveBeenCalled();
  });

  it('rolls back the product price when history append fails', async () => {
    products.findByIdForUpdate.mockResolvedValue(product());
    products.updatePrice.mockResolvedValue(product({ price: 650000 }));
    priceHistory.append.mockRejectedValue(new Error('history insert failed'));

    await expect(
      service.changeProductPrice({
        productId: PRODUCT_ID,
        newPrice: 650000,
        actor: { type: PriceHistoryActorType.ADMIN, id: ADMIN_ID },
      }),
    ).rejects.toThrow('history insert failed');
  });

  it('requires an admin principal for actor extraction', () => {
    expect(() =>
      service.requireAdminActor({
        subjectId: 'user-id',
        subjectType: AuthSubjectType.USER,
        sessionId: 'session-id',
      }),
    ).toThrow(PricingAdminRequiredError);

    expect(service.requireAdminActor(adminPrincipal)).toEqual({
      type: PriceHistoryActorType.ADMIN,
      id: ADMIN_ID,
    });
  });
});

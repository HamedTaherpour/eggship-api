import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import type { CategoryService } from '../../categories/application/category.service';
import type { ProductRepository } from '../../products/infrastructure/product.repository';
import { DiscountService } from './discount.service';
import {
  DiscountTarget,
  DiscountType,
  type DiscountRecord,
} from '../domain/discount';
import type { DiscountRepository } from '../infrastructure/discount.repository';
import type { TransactionRunner } from '../../../infrastructure/database/transaction';
import type { AuditLogService } from '../../audit/application/audit-log.service';

const DISCOUNT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const PRODUCT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function discount(overrides: Partial<DiscountRecord> = {}): DiscountRecord {
  const now = new Date('2026-08-22T12:00:00.000Z');
  return {
    id: DISCOUNT_ID,
    name: 'Promo',
    type: DiscountType.PERCENT,
    target: DiscountTarget.ORDER,
    percentValue: 10,
    fixedAmount: null,
    productId: null,
    categoryId: null,
    isActive: true,
    startsAt: null,
    endsAt: null,
    precedence: 0,
    maxQuantityPerCustomer: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('DiscountService', () => {
  let repository: jest.Mocked<
    Pick<DiscountRepository, 'findById' | 'create' | 'update'>
  >;
  let products: jest.Mocked<Pick<ProductRepository, 'findById'>>;
  let categories: jest.Mocked<Pick<CategoryService, 'findById'>>;
  let logger: jest.Mocked<Pick<ApplicationLogger, 'info'>>;
  let service: DiscountService;
  const transactions = {
    run: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  } as unknown as TransactionRunner;
  const audit = { append: jest.fn() } as unknown as AuditLogService;

  beforeEach(() => {
    repository = {
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    products = { findById: jest.fn() };
    categories = { findById: jest.fn() };
    logger = { info: jest.fn() };
    service = new DiscountService(
      repository as unknown as DiscountRepository,
      products as unknown as ProductRepository,
      categories as unknown as CategoryService,
      logger as unknown as ApplicationLogger,
      transactions,
      audit,
    );
  });

  it('creates an ORDER discount after validation', async () => {
    const created = discount();
    repository.create.mockResolvedValue(created);

    const result = await service.create({
      name: 'Promo',
      type: DiscountType.PERCENT,
      target: DiscountTarget.ORDER,
      percentValue: 10,
    });

    expect(result).toEqual(created);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        percentValue: 10,
        fixedAmount: null,
        productId: null,
        categoryId: null,
      }),
      expect.anything(),
    );
  });

  it('validates product targets before create', async () => {
    products.findById.mockResolvedValue(null);

    await expect(
      service.create({
        name: 'Bad product promo',
        type: DiscountType.FIXED,
        target: DiscountTarget.PRODUCT,
        fixedAmount: 1000,
        productId: PRODUCT_ID,
      }),
    ).rejects.toThrow(/product target/i);
  });

  it('merges existing state on update and deactivates explicitly', async () => {
    const existing = discount({
      productId: PRODUCT_ID,
      target: DiscountTarget.PRODUCT,
    });
    const updated = discount({
      ...existing,
      isActive: false,
    });
    repository.findById.mockResolvedValue(existing);
    products.findById.mockResolvedValue({
      id: PRODUCT_ID,
      name: 'Eggs',
      price: 1000,
      categoryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      isActive: true,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    });
    repository.update.mockResolvedValue(updated);

    const result = await service.deactivate(DISCOUNT_ID);
    expect(result.isActive).toBe(false);
    expect(repository.update).toHaveBeenCalledWith(
      DISCOUNT_ID,
      expect.objectContaining({ isActive: false }),
      expect.anything(),
    );
  });
});

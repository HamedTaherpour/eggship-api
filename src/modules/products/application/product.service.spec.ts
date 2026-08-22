import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { resolvePageRequest } from '../../../common/list';
import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import type { CategoryService } from '../../categories/application/category.service';
import type { CategoryRecord } from '../../categories/domain/category';
import type { ProductRecord } from '../domain/product';
import {
  ProductInvalidCategoryError,
  ProductNotFoundError,
} from '../domain/product-errors';
import type { ProductRepository } from '../infrastructure/product.repository';
import { AdminProductListQueryDto } from '../api/dto/admin-product-list-query.dto';
import { resolveAdminProductSort } from '../api/dto/admin-product-list-query.dto';
import { CreateProductBodyDto } from '../api/dto/create-product.dto';
import { PublicProductListQueryDto } from '../api/dto/public-product-list-query.dto';
import { resolvePublicProductSort } from '../api/dto/public-product-list-query.dto';
import {
  toAdminProductDto,
  toPublicProductDto,
} from '../api/dto/product-response.dto';
import { UpdateProductBodyDto } from '../api/dto/update-product.dto';
import { ProductService } from './product.service';
import type { InventoryService } from '../../inventory/application/inventory.service';
import type { PricingService } from '../../pricing/application/pricing.service';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import { AuthSubjectType } from '../../auth/domain/subject-type';
import {
  TRANSACTION_CONTEXT_BRAND,
  TransactionRunner,
  type TransactionContext,
} from '../../../infrastructure/database/transaction';

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

  override runRepeatableRead<T>(
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return this.run(fn);
  }
}

const CATEGORY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRODUCT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const adminPrincipal: AuthenticatedPrincipal = {
  subjectId: ADMIN_ID,
  subjectType: AuthSubjectType.ADMIN,
  sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};

function category(overrides: Partial<CategoryRecord> = {}): CategoryRecord {
  const now = new Date('2026-08-21T12:00:00.000Z');
  return {
    id: CATEGORY_ID,
    name: 'Eggs',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function product(overrides: Partial<ProductRecord> = {}): ProductRecord {
  const now = new Date('2026-08-21T12:00:00.000Z');
  return {
    id: PRODUCT_ID,
    name: 'Cage-free eggs (30)',
    price: 625000,
    categoryId: CATEGORY_ID,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('ProductService', () => {
  let repository: jest.Mocked<
    Pick<
      ProductRepository,
      'list' | 'findById' | 'findPublicById' | 'create' | 'update'
    >
  >;
  let categories: jest.Mocked<Pick<CategoryService, 'findById'>>;
  let inventory: jest.Mocked<Pick<InventoryService, 'ensureForProduct'>>;
  let pricing: jest.Mocked<
    Pick<PricingService, 'changeProductPrice' | 'requireAdminActor'>
  >;
  let logger: jest.Mocked<Pick<ApplicationLogger, 'info'>>;
  let service: ProductService;

  beforeEach(() => {
    repository = {
      list: jest.fn(),
      findById: jest.fn(),
      findPublicById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    categories = { findById: jest.fn() };
    inventory = { ensureForProduct: jest.fn() };
    pricing = {
      changeProductPrice: jest.fn(),
      requireAdminActor: jest.fn().mockReturnValue({
        type: 'ADMIN',
        id: ADMIN_ID,
      }),
    };
    logger = { info: jest.fn() };
    service = new ProductService(
      repository as unknown as ProductRepository,
      categories as unknown as CategoryService,
      inventory as unknown as InventoryService,
      pricing as unknown as PricingService,
      new ImmediateTransactionRunner(),
      logger as unknown as ApplicationLogger,
    );
  });

  it('maps public list to active products requiring an active category', async () => {
    const item = product();
    repository.list.mockResolvedValue({ items: [item], total: 1 });

    const query = plainToInstance(PublicProductListQueryDto, {
      page: '1',
      pageSize: '20',
      search: '  egg ',
      sortBy: 'price',
      sortOrder: 'desc',
      categoryId: CATEGORY_ID,
    });
    expect(await validate(query)).toHaveLength(0);

    const result = await service.listPublic(query);
    expect(repository.list).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      search: 'egg',
      sortBy: 'price',
      sortOrder: 'desc',
      categoryId: CATEGORY_ID,
      isActive: true,
      requireActiveCategory: true,
    });
    expect(result.meta.total).toBe(1);
    expect(toPublicProductDto(result.data[0]!)).toEqual({
      id: PRODUCT_ID,
      name: 'Cage-free eggs (30)',
      price: 625000,
      categoryId: CATEGORY_ID,
    });
  });

  it('uses public default sort name asc and admin default createdAt desc', () => {
    expect(resolvePageRequest({})).toEqual({ page: 1, pageSize: 20 });
    expect(resolvePublicProductSort({})).toEqual({
      sortBy: 'name',
      sortOrder: 'asc',
    });
    expect(resolveAdminProductSort({})).toEqual({
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
  });

  it('maps admin list filters including isActive', async () => {
    const item = product({ isActive: false });
    repository.list.mockResolvedValue({ items: [item], total: 1 });

    const query = plainToInstance(AdminProductListQueryDto, {
      page: '2',
      pageSize: '10',
      search: 'cage',
      sortBy: 'name',
      sortOrder: 'asc',
      categoryId: CATEGORY_ID,
      isActive: 'false',
    });
    expect(await validate(query)).toHaveLength(0);

    await service.listAdmin(query);
    expect(repository.list).toHaveBeenCalledWith({
      page: 2,
      pageSize: 10,
      search: 'cage',
      sortBy: 'name',
      sortOrder: 'asc',
      categoryId: CATEGORY_ID,
      isActive: false,
    });
  });

  it('rejects invalid public/admin sort fields and boolean filters', async () => {
    const badSort = plainToInstance(PublicProductListQueryDto, {
      sortBy: 'stock',
    });
    expect(await validate(badSort)).not.toHaveLength(0);

    const badBool = plainToInstance(AdminProductListQueryDto, {
      isActive: 'yes',
    });
    expect(await validate(badBool)).not.toHaveLength(0);
  });

  it('returns public detail or PRODUCT_NOT_FOUND', async () => {
    repository.findPublicById.mockResolvedValue(product());
    await expect(service.getPublicById(PRODUCT_ID)).resolves.toMatchObject({
      id: PRODUCT_ID,
      price: 625000,
    });

    repository.findPublicById.mockResolvedValue(null);
    await expect(service.getPublicById(PRODUCT_ID)).rejects.toBeInstanceOf(
      ProductNotFoundError,
    );
  });

  it('creates a product after validating category existence', async () => {
    categories.findById.mockResolvedValue(category());
    const created = product();
    repository.create.mockResolvedValue(created);

    const body = plainToInstance(CreateProductBodyDto, {
      name: '  Cage-free eggs (30) ',
      price: 625000,
      categoryId: CATEGORY_ID,
    });
    expect(await validate(body)).toHaveLength(0);

    await expect(service.create(body)).resolves.toEqual(created);
    expect(categories.findById).toHaveBeenCalledWith(CATEGORY_ID);
    expect(repository.create).toHaveBeenCalledWith(
      {
        name: 'Cage-free eggs (30)',
        price: 625000,
        categoryId: CATEGORY_ID,
        isActive: undefined,
      },
      expect.anything(),
    );
    expect(inventory.ensureForProduct).toHaveBeenCalledWith(
      PRODUCT_ID,
      expect.anything(),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'catalog.product.created',
        productId: PRODUCT_ID,
      }),
      'Product created',
    );
  });

  it('rejects create when category is missing', async () => {
    categories.findById.mockResolvedValue(null);
    const body = plainToInstance(CreateProductBodyDto, {
      name: 'Eggs',
      price: 1000,
      categoryId: CATEGORY_ID,
    });

    await expect(service.create(body)).rejects.toBeInstanceOf(
      ProductInvalidCategoryError,
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects DTO prices that are zero, negative, or non-integer', async () => {
    const zero = plainToInstance(CreateProductBodyDto, {
      name: 'Eggs',
      price: 0,
      categoryId: CATEGORY_ID,
    });
    expect(await validate(zero)).not.toHaveLength(0);

    const negative = plainToInstance(UpdateProductBodyDto, { price: -5 });
    expect(await validate(negative)).not.toHaveLength(0);

    const decimal = plainToInstance(CreateProductBodyDto, {
      name: 'Eggs',
      price: 12.5,
      categoryId: CATEGORY_ID,
    });
    expect(await validate(decimal)).not.toHaveLength(0);
  });

  it('updates allowlisted fields and routes price changes through PricingService', async () => {
    categories.findById.mockResolvedValue(category({ isActive: false }));
    const updated = product({ isActive: false, price: 700000 });
    pricing.changeProductPrice.mockResolvedValue({
      product: updated,
      historyWritten: true,
    });
    repository.update.mockResolvedValue(updated);

    const body = plainToInstance(UpdateProductBodyDto, {
      price: 700000,
      isActive: false,
      categoryId: CATEGORY_ID,
    });
    expect(await validate(body)).toHaveLength(0);

    await expect(
      service.update(PRODUCT_ID, body, adminPrincipal),
    ).resolves.toEqual(updated);
    expect(pricing.changeProductPrice).toHaveBeenCalledWith(
      {
        productId: PRODUCT_ID,
        newPrice: 700000,
        actor: { type: 'ADMIN', id: ADMIN_ID },
      },
      expect.anything(),
    );
    expect(repository.update).toHaveBeenCalledWith(
      PRODUCT_ID,
      {
        isActive: false,
        categoryId: CATEGORY_ID,
      },
      expect.anything(),
    );
    expect(toAdminProductDto(updated).price).toBe(700000);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'catalog.product.deactivated',
      }),
      'Product deactivated',
    );
  });

  it('does not write history when price is unchanged via ProductService no-op patch', async () => {
    repository.findById.mockResolvedValue(product());

    await expect(
      service.update(PRODUCT_ID, {}, adminPrincipal),
    ).resolves.toMatchObject({ price: 625000 });
    expect(pricing.changeProductPrice).not.toHaveBeenCalled();
  });

  it('throws PRODUCT_NOT_FOUND when update target is missing', async () => {
    pricing.changeProductPrice.mockRejectedValue(new ProductNotFoundError());
    await expect(
      service.update(PRODUCT_ID, { price: 700000 }, adminPrincipal),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('throws PRODUCT_NOT_FOUND when non-price update target is missing', async () => {
    repository.update.mockResolvedValue(null);
    await expect(
      service.update(PRODUCT_ID, { name: 'Gone' }, adminPrincipal),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('allows assigning an inactive category (public visibility still hides)', async () => {
    categories.findById.mockResolvedValue(category({ isActive: false }));
    repository.create.mockResolvedValue(product({ isActive: true }));

    await expect(
      service.create({
        name: 'Prep',
        price: 1000,
        categoryId: CATEGORY_ID,
      }),
    ).resolves.toBeDefined();
  });
});

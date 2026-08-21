import { Injectable } from '@nestjs/common';
import {
  resolvePageRequest,
  toPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/list';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { TransactionRunner } from '../../../infrastructure/database/transaction';
import { CategoryService } from '../../categories/application/category.service';
import { InventoryService } from '../../inventory/application/inventory.service';
import type { ProductRecord } from '../domain/product';
import {
  ProductInvalidCategoryError,
  ProductNotFoundError,
} from '../domain/product-errors';
import { ProductRepository } from '../infrastructure/product.repository';
import type { AdminProductListQueryDto } from '../api/dto/admin-product-list-query.dto';
import { resolveAdminProductSort } from '../api/dto/admin-product-list-query.dto';
import type { CreateProductBodyDto } from '../api/dto/create-product.dto';
import type { PublicProductListQueryDto } from '../api/dto/public-product-list-query.dto';
import { resolvePublicProductSort } from '../api/dto/public-product-list-query.dto';
import type { UpdateProductBodyDto } from '../api/dto/update-product.dto';

@Injectable()
export class ProductService {
  constructor(
    private readonly products: ProductRepository,
    private readonly categories: CategoryService,
    private readonly inventory: InventoryService,
    private readonly transactions: TransactionRunner,
    private readonly logger: ApplicationLogger,
  ) {}

  /**
   * Public storefront list: active products under active categories only.
   * Paginated; never exposes inactive products or `isActive` filter.
   */
  async listPublic(
    query: PublicProductListQueryDto,
  ): Promise<PaginatedResponse<ProductRecord>> {
    const pageRequest = resolvePageRequest(query);
    const sort = resolvePublicProductSort(query);
    const page = await this.products.list({
      page: pageRequest.page,
      pageSize: pageRequest.pageSize,
      search: query.search,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
      categoryId: query.categoryId,
      isActive: true,
      requireActiveCategory: true,
    });
    return toPaginatedResponse(page.items, pageRequest, page.total);
  }

  async getPublicById(id: string): Promise<ProductRecord> {
    const found = await this.products.findPublicById(id);
    if (found === null) {
      throw new ProductNotFoundError();
    }
    return found;
  }

  async listAdmin(
    query: AdminProductListQueryDto,
  ): Promise<PaginatedResponse<ProductRecord>> {
    const pageRequest = resolvePageRequest(query);
    const sort = resolveAdminProductSort(query);
    const page = await this.products.list({
      page: pageRequest.page,
      pageSize: pageRequest.pageSize,
      search: query.search,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
      categoryId: query.categoryId,
      isActive: query.isActive,
    });
    return toPaginatedResponse(page.items, pageRequest, page.total);
  }

  async getAdminById(id: string): Promise<ProductRecord> {
    const found = await this.products.findById(id);
    if (found === null) {
      throw new ProductNotFoundError();
    }
    return found;
  }

  async create(body: CreateProductBodyDto): Promise<ProductRecord> {
    await this.requireExistingCategory(body.categoryId);

    const created = await this.transactions.run(async (tx) => {
      const product = await this.products.create(
        {
          name: body.name,
          price: body.price,
          categoryId: body.categoryId,
          isActive: body.isActive,
        },
        tx,
      );
      await this.inventory.ensureForProduct(product.id, tx);
      return product;
    });
    this.logger.info(
      {
        module: 'products',
        operation: 'catalog.product.created',
        productId: created.id,
        categoryId: created.categoryId,
        isActive: created.isActive,
      },
      'Product created',
    );
    return created;
  }

  async update(id: string, body: UpdateProductBodyDto): Promise<ProductRecord> {
    if (body.categoryId !== undefined) {
      await this.requireExistingCategory(body.categoryId);
    }

    const patch: {
      name?: string;
      price?: number;
      categoryId?: string;
      isActive?: boolean;
    } = {};
    if (body.name !== undefined) {
      patch.name = body.name;
    }
    if (body.price !== undefined) {
      patch.price = body.price;
    }
    if (body.categoryId !== undefined) {
      patch.categoryId = body.categoryId;
    }
    if (body.isActive !== undefined) {
      patch.isActive = body.isActive;
    }

    const updated = await this.products.update(id, patch);
    if (updated === null) {
      throw new ProductNotFoundError();
    }

    const operation =
      body.isActive === false
        ? 'catalog.product.deactivated'
        : 'catalog.product.updated';

    this.logger.info(
      {
        module: 'products',
        operation,
        productId: updated.id,
        categoryId: updated.categoryId,
        isActive: updated.isActive,
      },
      body.isActive === false ? 'Product deactivated' : 'Product updated',
    );
    return updated;
  }

  private async requireExistingCategory(categoryId: string): Promise<void> {
    const category = await this.categories.findById(categoryId);
    if (category === null) {
      throw new ProductInvalidCategoryError(
        'Category does not exist for this product.',
      );
    }
  }
}

import { Injectable, Optional } from '@nestjs/common';
import {
  resolvePageRequest,
  toPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/list';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { TransactionRunner } from '../../../infrastructure/database/transaction';
import { CategoryService } from '../../categories/application/category.service';
import { InventoryService } from '../../inventory/application/inventory.service';
import { PricingService } from '../../pricing/application/pricing.service';
import { MediaService } from '../../media/application/media.service';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
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
    private readonly pricing: PricingService,
    private readonly transactions: TransactionRunner,
    private readonly logger: ApplicationLogger,
    @Optional() private readonly media?: MediaService,
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
    return toPaginatedResponse(
      await this.withMediaPresentations(page.items),
      pageRequest,
      page.total,
    );
  }

  async getPublicById(id: string): Promise<ProductRecord> {
    const found = await this.products.findPublicById(id);
    if (found === null) {
      throw new ProductNotFoundError();
    }
    return (await this.withMediaPresentations([found]))[0]!;
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
    return toPaginatedResponse(
      await this.withMediaPresentations(page.items),
      pageRequest,
      page.total,
    );
  }

  async getAdminById(id: string): Promise<ProductRecord> {
    const found = await this.products.findById(id);
    if (found === null) {
      throw new ProductNotFoundError();
    }
    return (await this.withMediaPresentations([found]))[0]!;
  }

  async create(body: CreateProductBodyDto): Promise<ProductRecord> {
    await this.requireExistingCategory(body.categoryId);

    const created = await this.transactions.run(async (tx) => {
      if (body.imageMediaId !== undefined && body.imageMediaId !== null) {
        if (this.media === undefined)
          throw new Error('Media module is not configured.');
        await this.media.getImageReference(body.imageMediaId, tx);
      }
      const product = await this.products.create(
        {
          name: body.name,
          price: body.price,
          categoryId: body.categoryId,
          isActive: body.isActive,
          ...(body.imageMediaId !== undefined
            ? { imageMediaId: body.imageMediaId }
            : {}),
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
    return (await this.withMediaPresentations([created]))[0]!;
  }

  async update(
    id: string,
    body: UpdateProductBodyDto,
    principal: AuthenticatedPrincipal,
  ): Promise<ProductRecord> {
    if (body.categoryId !== undefined) {
      await this.requireExistingCategory(body.categoryId);
    }

    const patch: {
      name?: string;
      categoryId?: string;
      isActive?: boolean;
      imageMediaId?: string | null;
    } = {};
    if (body.name !== undefined) {
      patch.name = body.name;
    }
    if (body.categoryId !== undefined) {
      patch.categoryId = body.categoryId;
    }
    if (body.isActive !== undefined) {
      patch.isActive = body.isActive;
    }
    if (body.imageMediaId !== undefined) patch.imageMediaId = body.imageMediaId;

    const hasPriceChange = body.price !== undefined;
    const hasOtherChanges = Object.keys(patch).length > 0;

    if (!hasPriceChange && !hasOtherChanges) {
      const current = await this.products.findById(id);
      if (current === null) {
        throw new ProductNotFoundError();
      }
      return current;
    }

    const actor = hasPriceChange
      ? this.pricing.requireAdminActor(principal)
      : undefined;

    const updated = await this.transactions.run(async (tx) => {
      if (body.imageMediaId !== undefined) {
        const lockedProduct = await this.products.findByIdForUpdate(id, tx);
        if (lockedProduct === null) throw new ProductNotFoundError();
        if (body.imageMediaId !== null) {
          if (this.media === undefined)
            throw new Error('Media module is not configured.');
          await this.media.getImageReference(body.imageMediaId, tx);
        }
      }
      let product: ProductRecord | null = null;

      if (hasPriceChange) {
        const priceResult = await this.pricing.changeProductPrice(
          {
            productId: id,
            newPrice: body.price!,
            actor: actor!,
          },
          tx,
        );
        product = priceResult.product;
      }

      if (hasOtherChanges) {
        product = await this.products.update(id, patch, tx);
        if (product === null) {
          throw new ProductNotFoundError();
        }
      }

      if (product === null) {
        throw new ProductNotFoundError();
      }
      return product;
    });

    const operation =
      body.isActive === false
        ? 'catalog.product.deactivated'
        : hasPriceChange
          ? 'catalog.product.price_changed'
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
    return (await this.withMediaPresentations([updated]))[0]!;
  }

  private async requireExistingCategory(categoryId: string): Promise<void> {
    const category = await this.categories.findById(categoryId);
    if (category === null) {
      throw new ProductInvalidCategoryError(
        'Category does not exist for this product.',
      );
    }
  }

  private async withMediaPresentations(
    records: ProductRecord[],
  ): Promise<ProductRecord[]> {
    if (this.media === undefined) return records;
    const presentations = await this.media.presentations(
      records.map((record) => record.imageMediaId),
    );
    return records.map((record) => ({
      ...record,
      image: record.imageMediaId
        ? (presentations.get(record.imageMediaId) ?? null)
        : null,
    }));
  }
}

import { Injectable } from '@nestjs/common';
import {
  resolvePageRequest,
  toPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/list';
import { ProductNotFoundError } from '../../products/domain/product-errors';
import { ProductRepository } from '../../products/infrastructure/product.repository';
import type { PriceHistoryRecord } from '../domain/price-history';
import { PriceHistoryRepository } from '../infrastructure/price-history.repository';
import type { AdminPriceHistoryListQueryDto } from '../api/dto/admin-price-history-query.dto';

/**
 * Admin pricing read queries (PRC-04). Price history is append-only — no mutation.
 */
@Injectable()
export class AdminPricingQueryService {
  constructor(
    private readonly products: ProductRepository,
    private readonly priceHistory: PriceHistoryRepository,
  ) {}

  async listPriceHistory(
    productId: string,
    query: AdminPriceHistoryListQueryDto,
  ): Promise<PaginatedResponse<PriceHistoryRecord>> {
    const product = await this.products.findById(productId);
    if (product === null) {
      throw new ProductNotFoundError();
    }

    const pageRequest = resolvePageRequest(query);
    const page = await this.priceHistory.listByProductPaginated({
      productId,
      page: pageRequest.page,
      pageSize: pageRequest.pageSize,
    });
    return toPaginatedResponse(page.items, pageRequest, page.total);
  }
}

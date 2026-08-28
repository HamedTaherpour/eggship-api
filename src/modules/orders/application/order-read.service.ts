import { Injectable } from '@nestjs/common';
import {
  resolvePageRequest,
  toPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/list';
import type { CustomerOrderListQueryDto } from '../api/dto/customer-order-list-query.dto';
import { resolveCustomerOrderSort } from '../api/dto/customer-order-list-query.dto';
import { OrderNotFoundError } from '../domain/order-errors';
import type { OrderRecord } from '../domain/order';
import type { OrderListRecord } from '../domain/order-list';
import { OrderRepository } from '../infrastructure/order.repository';

@Injectable()
export class OrderReadService {
  constructor(private readonly orders: OrderRepository) {}

  async listOwned(
    ownerId: string,
    query: CustomerOrderListQueryDto,
  ): Promise<PaginatedResponse<OrderListRecord>> {
    const pageRequest = resolvePageRequest(query);
    const sort = resolveCustomerOrderSort(query);
    const page = await this.orders.listOwned(ownerId, {
      page: pageRequest.page,
      pageSize: pageRequest.pageSize,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
      status: query.status,
      createdFrom:
        query.createdFrom === undefined
          ? undefined
          : new Date(query.createdFrom),
      createdTo:
        query.createdTo === undefined ? undefined : new Date(query.createdTo),
    });
    return toPaginatedResponse(page.items, pageRequest, page.total);
  }

  async getOwned(ownerId: string, orderId: string): Promise<OrderRecord> {
    const found = await this.orders.findOwnedById(orderId, ownerId);
    if (found === null) {
      throw new OrderNotFoundError();
    }
    return found;
  }
}

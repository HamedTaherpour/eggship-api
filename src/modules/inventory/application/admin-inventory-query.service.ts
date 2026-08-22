import { Injectable } from '@nestjs/common';
import {
  resolvePageRequest,
  toPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/list';
import type { InventoryReconciliationResult } from '../domain/inventory-reconciliation';
import { InventoryNotFoundError } from '../domain/inventory-errors';
import { InventoryHttpMessage } from '../domain/inventory-http-messages';
import type { InventoryLedgerEntry } from '../domain/inventory-ledger';
import type { InventoryListRecord } from '../domain/inventory-list';
import type { InventoryReservation } from '../domain/inventory-reservation';
import { assertInventoryUuid } from '../domain/inventory-quantity';
import { InventoryBalanceRepository } from '../infrastructure/inventory-balance.repository';
import { InventoryLedgerRepository } from '../infrastructure/inventory-ledger.repository';
import { InventoryReservationRepository } from '../infrastructure/inventory-reservation.repository';
import { InventoryReconciliationService } from './inventory-reconciliation.service';
import type { AdminInventoryLedgerListQueryDto } from '../api/dto/admin-inventory-ledger-query.dto';
import type { AdminInventoryListQueryDto } from '../api/dto/admin-inventory-list-query.dto';
import type { AdminInventoryReservationListQueryDto } from '../api/dto/admin-inventory-reservation-query.dto';
import { resolveAdminInventoryListSort } from '../api/dto/admin-inventory-list-query.dto';

/**
 * Admin inventory read/diagnostic queries (INV-06). No mutations or repair.
 */
@Injectable()
export class AdminInventoryQueryService {
  constructor(
    private readonly balances: InventoryBalanceRepository,
    private readonly ledger: InventoryLedgerRepository,
    private readonly reservations: InventoryReservationRepository,
    private readonly reconciliation: InventoryReconciliationService,
  ) {}

  async listAdmin(
    query: AdminInventoryListQueryDto,
  ): Promise<PaginatedResponse<InventoryListRecord>> {
    const pageRequest = resolvePageRequest(query);
    const sort = resolveAdminInventoryListSort(query);
    const page = await this.balances.listAdmin({
      page: pageRequest.page,
      pageSize: pageRequest.pageSize,
      search: query.search,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
      isActive: query.isActive,
    });
    return toPaginatedResponse(page.items, pageRequest, page.total);
  }

  async listLedger(
    productId: string,
    query: AdminInventoryLedgerListQueryDto,
  ): Promise<PaginatedResponse<InventoryLedgerEntry>> {
    const id = assertInventoryUuid(productId, 'productId');
    await this.requireInventory(id);

    const pageRequest = resolvePageRequest(query);
    const page = await this.ledger.listByProductPaginated({
      productId: id,
      page: pageRequest.page,
      pageSize: pageRequest.pageSize,
      type: query.type,
      createdFrom:
        query.createdFrom === undefined
          ? undefined
          : new Date(query.createdFrom),
      createdTo:
        query.createdTo === undefined ? undefined : new Date(query.createdTo),
    });
    return toPaginatedResponse(page.items, pageRequest, page.total);
  }

  async listReservations(
    productId: string,
    query: AdminInventoryReservationListQueryDto,
  ): Promise<PaginatedResponse<InventoryReservation>> {
    const id = assertInventoryUuid(productId, 'productId');
    await this.requireInventory(id);

    const pageRequest = resolvePageRequest(query);
    const page = await this.reservations.listByProductPaginated({
      productId: id,
      page: pageRequest.page,
      pageSize: pageRequest.pageSize,
      status: query.status,
    });
    return toPaginatedResponse(page.items, pageRequest, page.total);
  }

  async reconcileProduct(
    productId: string,
  ): Promise<InventoryReconciliationResult> {
    return this.reconciliation.reconcileProduct(productId);
  }

  private async requireInventory(productId: string): Promise<void> {
    const balance = await this.balances.findByProductId(productId);
    if (balance === null) {
      throw new InventoryNotFoundError(InventoryHttpMessage.NOT_FOUND, {
        productId,
      });
    }
  }
}

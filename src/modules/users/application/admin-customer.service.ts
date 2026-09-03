import { Injectable } from '@nestjs/common';
import {
  resolvePageRequest,
  toPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/list';
import type { AdminCustomerRecord } from '../domain/customer-admin';
import { CustomerNotFoundError } from '../domain/customer-errors';
import { AdminCustomerRepository } from '../infrastructure/admin-customer.repository';
import {
  resolveAdminCustomerSort,
  type AdminCustomerListQueryDto,
} from '../api/dto/admin-customer-list-query.dto';

/**
 * Admin store/customer read application service (ADM-02).
 *
 * Read-only: list + detail over the existing `User` identity with joined
 * immutable referral evidence. No mutation, no credential handling, no
 * business-profile invention (MIG-01 pending). Reads are not audited
 * (AUD-03 precedent: ordinary audit reads append no AuditLog event) and
 * emit no per-request success log carrying phone PII.
 */
@Injectable()
export class AdminCustomerService {
  constructor(private readonly customers: AdminCustomerRepository) {}

  async listAdmin(
    query: AdminCustomerListQueryDto,
  ): Promise<PaginatedResponse<AdminCustomerRecord>> {
    const pageRequest = resolvePageRequest(query);
    const sort = resolveAdminCustomerSort(query);
    const page = await this.customers.list({
      page: pageRequest.page,
      pageSize: pageRequest.pageSize,
      search: query.search,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
      isActive: query.isActive,
      hasReferral: query.hasReferral,
    });
    return toPaginatedResponse(page.items, pageRequest, page.total);
  }

  async getAdminById(id: string): Promise<AdminCustomerRecord> {
    const found = await this.customers.findById(id);
    if (found === null) {
      throw new CustomerNotFoundError();
    }
    return found;
  }
}

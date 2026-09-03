import { Injectable } from '@nestjs/common';
import {
  resolvePageRequest,
  toPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/list';
import type {
  AdminReferralEvidenceRecord,
  AdminVisitorRecord,
} from '../domain/visitor';
import { VisitorNotFoundError } from '../domain/visitor-errors';
import { VisitorRepository } from '../infrastructure/visitor.repository';
import {
  resolveAdminReferralSort,
  resolveAdminVisitorSort,
} from '../api/dto/admin-visitor-list-query.dto';
import type {
  AdminReferralEvidenceListQueryDto,
  AdminVisitorListQueryDto,
} from '../api/dto/admin-visitor-list-query.dto';

@Injectable()
export class AdminVisitorService {
  constructor(private readonly visitors: VisitorRepository) {}

  async list(
    query: AdminVisitorListQueryDto,
  ): Promise<PaginatedResponse<AdminVisitorRecord>> {
    const page = resolvePageRequest(query);
    const sort = resolveAdminVisitorSort(query);
    const result = await this.visitors.listAdmin({
      ...query,
      page: page.page,
      pageSize: page.pageSize,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
    });
    return toPaginatedResponse(result.items, page, result.total);
  }

  async get(id: string): Promise<AdminVisitorRecord> {
    const result = await this.visitors.findAdminById(id);
    if (result === null) throw new VisitorNotFoundError();
    return result;
  }

  async listReferrals(
    id: string,
    query: AdminReferralEvidenceListQueryDto,
  ): Promise<PaginatedResponse<AdminReferralEvidenceRecord>> {
    const page = resolvePageRequest(query);
    const sort = resolveAdminReferralSort(query);
    const visitor = await this.visitors.findAdminById(id);
    if (visitor === null) throw new VisitorNotFoundError();
    const result = await this.visitors.listAdminReferrals({
      ...query,
      visitorId: id,
      page: page.page,
      pageSize: page.pageSize,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
    });
    return toPaginatedResponse(result.items, page, result.total);
  }
}

import { Injectable } from '@nestjs/common';
import {
  resolvePageRequest,
  toPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/list';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { TransactionRunner } from '../../../infrastructure/database/transaction';
import { AuditLogService } from '../../audit/application/audit-log.service';
import { AuditAction, AuditEntityType } from '../../audit/domain/audit-event';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import type { RegionRecord } from '../domain/region';
import { RegionNotFoundError } from '../domain/region-errors';
import { RegionRepository } from '../infrastructure/region.repository';
import type { AdminRegionListQueryDto } from '../api/dto/admin-region-list-query.dto';
import { resolveRegionSort } from '../api/dto/admin-region-list-query.dto';
import type { CreateRegionBodyDto } from '../api/dto/create-region.dto';
import type { UpdateRegionBodyDto } from '../api/dto/update-region.dto';

@Injectable()
export class RegionService {
  constructor(
    private readonly regions: RegionRepository,
    private readonly logger: ApplicationLogger,
    private readonly transactions: TransactionRunner,
    private readonly audit: AuditLogService,
  ) {}

  /** Public storefront: active regions only, full list (tiny reference set). */
  async listPublicActive(): Promise<RegionRecord[]> {
    return this.regions.listActiveOrderedByName();
  }

  async listAdmin(
    query: AdminRegionListQueryDto,
  ): Promise<PaginatedResponse<RegionRecord>> {
    const pageRequest = resolvePageRequest(query);
    const sort = resolveRegionSort(query);
    const page = await this.regions.list({
      page: pageRequest.page,
      pageSize: pageRequest.pageSize,
      search: query.search,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
      isActive: query.isActive,
    });
    return toPaginatedResponse(page.items, pageRequest, page.total);
  }

  async create(
    body: CreateRegionBodyDto,
    principal?: AuthenticatedPrincipal,
  ): Promise<RegionRecord> {
    const created = await this.transactions.run(async (tx) => {
      const created = await this.regions.create(
        { name: body.name, isActive: body.isActive },
        tx,
      );
      if (principal !== undefined) {
        await this.audit.append(
          {
            action: AuditAction.REGION_CREATED,
            actorType: 'ADMIN',
            actorId: principal.subjectId,
            entityType: AuditEntityType.REGION,
            entityId: created.id,
            metadata: undefined,
          },
          tx,
        );
      }
      return created;
    });
    this.logger.info(
      {
        module: 'regions',
        operation: 'region.created',
        regionId: created.id,
        isActive: created.isActive,
      },
      'Region created',
    );
    return created;
  }

  async update(
    id: string,
    body: UpdateRegionBodyDto,
    principal?: AuthenticatedPrincipal,
  ): Promise<RegionRecord> {
    const patch: { name?: string; isActive?: boolean } = {};
    if (body.name !== undefined) {
      patch.name = body.name;
    }
    if (body.isActive !== undefined) {
      patch.isActive = body.isActive;
    }

    const updated = await this.transactions.run(async (tx) => {
      const before = await this.regions.findById(id, tx);
      if (before === null) return null;
      const updated = await this.regions.update(id, patch, tx);
      if (updated !== null && principal !== undefined) {
        const changedFields = regionChangedFields(before, updated);
        if (changedFields.length > 0) {
          await this.audit.append(
            {
              action: AuditAction.REGION_UPDATED,
              actorType: 'ADMIN',
              actorId: principal.subjectId,
              entityType: AuditEntityType.REGION,
              entityId: updated.id,
              metadata: { changedFields },
            },
            tx,
          );
        }
      }
      return updated;
    });
    if (updated === null) {
      throw new RegionNotFoundError();
    }

    this.logger.info(
      {
        module: 'regions',
        operation: 'region.updated',
        regionId: updated.id,
        isActive: updated.isActive,
      },
      'Region updated',
    );
    return updated;
  }
}

function regionChangedFields(
  before: RegionRecord,
  after: RegionRecord,
): string[] {
  const fields: string[] = [];
  if (before.name !== after.name) fields.push('name');
  if (before.isActive !== after.isActive) fields.push('isActive');
  return fields;
}

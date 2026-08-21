import { Injectable } from '@nestjs/common';
import {
  resolvePageRequest,
  toPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/list';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
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

  async create(body: CreateRegionBodyDto): Promise<RegionRecord> {
    const created = await this.regions.create({
      name: body.name,
      isActive: body.isActive,
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

  async update(id: string, body: UpdateRegionBodyDto): Promise<RegionRecord> {
    const patch: { name?: string; isActive?: boolean } = {};
    if (body.name !== undefined) {
      patch.name = body.name;
    }
    if (body.isActive !== undefined) {
      patch.isActive = body.isActive;
    }

    const updated = await this.regions.update(id, patch);
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

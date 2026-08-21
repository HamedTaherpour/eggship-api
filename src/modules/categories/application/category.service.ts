import { Injectable } from '@nestjs/common';
import {
  resolvePageRequest,
  toPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/list';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import type { CategoryRecord } from '../domain/category';
import { CategoryNotFoundError } from '../domain/category-errors';
import { CategoryRepository } from '../infrastructure/category.repository';
import type { AdminCategoryListQueryDto } from '../api/dto/admin-category-list-query.dto';
import { resolveCategorySort } from '../api/dto/admin-category-list-query.dto';
import type { CreateCategoryBodyDto } from '../api/dto/create-category.dto';
import type { UpdateCategoryBodyDto } from '../api/dto/update-category.dto';

@Injectable()
export class CategoryService {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly logger: ApplicationLogger,
  ) {}

  /** Public storefront: active categories only, full list (tiny reference set). */
  async listPublicActive(): Promise<CategoryRecord[]> {
    return this.categories.listActiveOrderedByName();
  }

  /** Cross-module lookup (e.g. Product category validation). */
  async findById(id: string): Promise<CategoryRecord | null> {
    return this.categories.findById(id);
  }

  async listAdmin(
    query: AdminCategoryListQueryDto,
  ): Promise<PaginatedResponse<CategoryRecord>> {
    const pageRequest = resolvePageRequest(query);
    const sort = resolveCategorySort(query);
    const page = await this.categories.list({
      page: pageRequest.page,
      pageSize: pageRequest.pageSize,
      search: query.search,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
      isActive: query.isActive,
    });
    return toPaginatedResponse(page.items, pageRequest, page.total);
  }

  async create(body: CreateCategoryBodyDto): Promise<CategoryRecord> {
    const created = await this.categories.create({
      name: body.name,
      isActive: body.isActive,
    });
    this.logger.info(
      {
        module: 'categories',
        operation: 'catalog.category.created',
        categoryId: created.id,
        isActive: created.isActive,
      },
      'Category created',
    );
    return created;
  }

  async update(
    id: string,
    body: UpdateCategoryBodyDto,
  ): Promise<CategoryRecord> {
    const patch: { name?: string; isActive?: boolean } = {};
    if (body.name !== undefined) {
      patch.name = body.name;
    }
    if (body.isActive !== undefined) {
      patch.isActive = body.isActive;
    }

    const updated = await this.categories.update(id, patch);
    if (updated === null) {
      throw new CategoryNotFoundError();
    }

    this.logger.info(
      {
        module: 'categories',
        operation: 'catalog.category.updated',
        categoryId: updated.id,
        isActive: updated.isActive,
      },
      'Category updated',
    );
    return updated;
  }
}

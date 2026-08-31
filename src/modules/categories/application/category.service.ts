import { Injectable } from '@nestjs/common';
import {
  resolvePageRequest,
  toPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/list';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { TransactionRunner } from '../../../infrastructure/database/transaction';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import { AuditLogService } from '../../audit/application/audit-log.service';
import { AuditAction, AuditEntityType } from '../../audit/domain/audit-event';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
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
    private readonly transactions: TransactionRunner,
    private readonly audit: AuditLogService,
  ) {}

  /** Public storefront: active categories only, full list (tiny reference set). */
  async listPublicActive(): Promise<CategoryRecord[]> {
    return this.categories.listActiveOrderedByName();
  }

  /** Cross-module lookup (e.g. Product category validation). */
  async findById(
    id: string,
    tx?: TransactionContext,
  ): Promise<CategoryRecord | null> {
    return this.categories.findById(id, tx);
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

  async create(
    body: CreateCategoryBodyDto,
    principal?: AuthenticatedPrincipal,
  ): Promise<CategoryRecord> {
    const created = await this.transactions.run(async (tx) => {
      const created = await this.categories.create(
        {
          name: body.name,
          isActive: body.isActive,
        },
        tx,
      );
      if (principal !== undefined) {
        await this.audit.append(
          {
            action: AuditAction.CATEGORY_CREATED,
            actorType: 'ADMIN',
            actorId: principal.subjectId,
            entityType: AuditEntityType.CATEGORY,
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
    principal?: AuthenticatedPrincipal,
  ): Promise<CategoryRecord> {
    const patch: { name?: string; isActive?: boolean } = {};
    if (body.name !== undefined) {
      patch.name = body.name;
    }
    if (body.isActive !== undefined) {
      patch.isActive = body.isActive;
    }

    const updated = await this.transactions.run(async (tx) => {
      const before = await this.categories.findById(id, tx);
      if (before === null) return null;
      const updated = await this.categories.update(id, patch, tx);
      if (updated !== null && principal !== undefined) {
        const changedFields = categoryChangedFields(before, updated);
        if (changedFields.length > 0) {
          await this.audit.append(
            {
              action: AuditAction.CATEGORY_UPDATED,
              actorType: 'ADMIN',
              actorId: principal.subjectId,
              entityType: AuditEntityType.CATEGORY,
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

function categoryChangedFields(
  before: CategoryRecord,
  after: CategoryRecord,
): string[] {
  const fields: string[] = [];
  if (before.name !== after.name) fields.push('name');
  if (before.isActive !== after.isActive) fields.push('isActive');
  return fields;
}

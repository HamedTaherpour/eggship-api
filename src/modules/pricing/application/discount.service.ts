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
import { CategoryService } from '../../categories/application/category.service';
import { ProductRepository } from '../../products/infrastructure/product.repository';
import type { AdminDiscountListQueryDto } from '../api/dto/admin-discount-list-query.dto';
import { resolveDiscountSort } from '../api/dto/admin-discount-list-query.dto';
import type {
  CreateDiscountInput,
  DiscountPayload,
  DiscountRecord,
  UpdateDiscountInput,
} from '../domain/discount';
import { DiscountTarget } from '../domain/discount';
import {
  DiscountInvalidCategoryError,
  DiscountInvalidProductError,
  DiscountNotFoundError,
} from '../domain/discount-errors';
import { buildDiscountPayload } from '../domain/discount-lifecycle';
import { normalizeDiscountName } from '../domain/discount-name';
import { normalizeDiscountPrecedence } from '../domain/discount-precedence';
import { DiscountRepository } from '../infrastructure/discount.repository';

/**
 * Discount application boundary (PRC-02). Owns admin discount persistence and
 * lifecycle validation. Calculation and HTTP APIs are later PRC tasks.
 */
@Injectable()
export class DiscountService {
  constructor(
    private readonly discounts: DiscountRepository,
    private readonly products: ProductRepository,
    private readonly categories: CategoryService,
    private readonly logger: ApplicationLogger,
    private readonly transactions: TransactionRunner,
    private readonly audit: AuditLogService,
  ) {}

  async findById(id: string): Promise<DiscountRecord | null> {
    return this.discounts.findById(id);
  }

  async listAdmin(
    query: AdminDiscountListQueryDto,
  ): Promise<PaginatedResponse<DiscountRecord>> {
    const pageRequest = resolvePageRequest(query);
    const sort = resolveDiscountSort(query);
    const page = await this.discounts.list({
      page: pageRequest.page,
      pageSize: pageRequest.pageSize,
      search: query.search,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
      isActive: query.isActive,
      type: query.type,
      target: query.target,
    });
    return toPaginatedResponse(page.items, pageRequest, page.total);
  }

  async create(
    input: CreateDiscountInput,
    principal?: AuthenticatedPrincipal,
  ): Promise<DiscountRecord> {
    const created = await this.transactions.run(async (tx) => {
      const payload = await this.preparePayload({
        name: input.name,
        type: input.type,
        target: input.target,
        percentValue: input.percentValue,
        fixedAmount: input.fixedAmount,
        productId: input.productId,
        categoryId: input.categoryId,
        isActive: input.isActive ?? true,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        precedence: input.precedence ?? 0,
        maxQuantityPerCustomer: input.maxQuantityPerCustomer,
        tx,
      });

      const created = await this.discounts.create(payload, tx);
      if (principal !== undefined) {
        await this.audit.append(
          {
            action: AuditAction.DISCOUNT_CREATED,
            actorType: 'ADMIN',
            actorId: principal.subjectId,
            entityType: AuditEntityType.DISCOUNT,
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
        module: 'pricing',
        operation: 'pricing.discount.created',
        discountId: created.id,
        type: created.type,
        target: created.target,
        isActive: created.isActive,
      },
      'Discount created',
    );
    return created;
  }

  async update(
    id: string,
    input: UpdateDiscountInput,
    principal?: AuthenticatedPrincipal,
  ): Promise<DiscountRecord> {
    const result = await this.transactions.run(async (tx) => {
      const existing = await this.discounts.findById(id, tx);
      if (existing === null) {
        throw new DiscountNotFoundError();
      }

      const target = input.target ?? existing.target;
      const productId = resolveProductIdForTarget(target, existing, input);
      const categoryId = resolveCategoryIdForTarget(target, existing, input);

      const payload = await this.preparePayload({
        name: input.name ?? existing.name,
        type: input.type ?? existing.type,
        target,
        percentValue:
          input.percentValue !== undefined
            ? input.percentValue
            : existing.percentValue,
        fixedAmount:
          input.fixedAmount !== undefined
            ? input.fixedAmount
            : existing.fixedAmount,
        productId,
        categoryId,
        isActive: input.isActive ?? existing.isActive,
        startsAt:
          input.startsAt !== undefined ? input.startsAt : existing.startsAt,
        endsAt: input.endsAt !== undefined ? input.endsAt : existing.endsAt,
        precedence:
          input.precedence !== undefined
            ? input.precedence
            : existing.precedence,
        maxQuantityPerCustomer:
          input.maxQuantityPerCustomer !== undefined
            ? input.maxQuantityPerCustomer
            : target === DiscountTarget.PRODUCT
              ? existing.maxQuantityPerCustomer
              : null,
        tx,
      });

      const updated = await this.discounts.update(id, payload, tx);
      if (updated === null) {
        throw new DiscountNotFoundError();
      }

      if (principal !== undefined) {
        const changedFields = discountChangedFields(existing, updated);
        if (changedFields.length > 0) {
          if (existing.isActive && !updated.isActive) {
            await this.audit.append(
              {
                action: AuditAction.DISCOUNT_DEACTIVATED,
                actorType: 'ADMIN',
                actorId: principal.subjectId,
                entityType: AuditEntityType.DISCOUNT,
                entityId: updated.id,
                metadata: undefined,
              },
              tx,
            );
          } else {
            await this.audit.append(
              {
                action: AuditAction.DISCOUNT_UPDATED,
                actorType: 'ADMIN',
                actorId: principal.subjectId,
                entityType: AuditEntityType.DISCOUNT,
                entityId: updated.id,
                metadata: { changedFields },
              },
              tx,
            );
          }
        }
      }
      return updated;
    });

    this.logger.info(
      {
        module: 'pricing',
        operation: 'pricing.discount.updated',
        discountId: result.id,
        isActive: result.isActive,
      },
      'Discount updated',
    );
    return result;
  }

  async activate(
    id: string,
    principal?: AuthenticatedPrincipal,
  ): Promise<DiscountRecord> {
    return this.update(id, { isActive: true }, principal);
  }

  async deactivate(
    id: string,
    principal?: AuthenticatedPrincipal,
  ): Promise<DiscountRecord> {
    return this.update(id, { isActive: false }, principal);
  }

  private async preparePayload(input: {
    name: string;
    type: CreateDiscountInput['type'];
    target: CreateDiscountInput['target'];
    percentValue?: number | null;
    fixedAmount?: number | null;
    productId?: string | null;
    categoryId?: string | null;
    isActive: boolean;
    startsAt?: Date | null;
    endsAt?: Date | null;
    precedence: number;
    maxQuantityPerCustomer?: number | null;
    tx?: TransactionContext;
  }): Promise<DiscountPayload> {
    const payload = buildDiscountPayload({
      name: normalizeDiscountName(input.name),
      type: input.type,
      target: input.target,
      percentValue: input.percentValue,
      fixedAmount: input.fixedAmount,
      productId: input.productId,
      categoryId: input.categoryId,
      isActive: input.isActive,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      precedence: normalizeDiscountPrecedence(input.precedence),
      maxQuantityPerCustomer: input.maxQuantityPerCustomer,
    });

    await this.assertTargetReferencesExist(payload, input.tx);
    return payload;
  }

  private async assertTargetReferencesExist(
    payload: DiscountPayload,
    tx?: TransactionContext,
  ): Promise<void> {
    if (payload.productId !== null) {
      const product = await this.products.findById(payload.productId, tx);
      if (product === null) {
        throw new DiscountInvalidProductError();
      }
    }

    if (payload.categoryId !== null) {
      const category = await this.categories.findById(payload.categoryId, tx);
      if (category === null) {
        throw new DiscountInvalidCategoryError();
      }
    }
  }
}

function resolveProductIdForTarget(
  target: DiscountTarget,
  existing: DiscountRecord,
  input: UpdateDiscountInput,
): string | null {
  if (target === DiscountTarget.ORDER) {
    return input.productId ?? null;
  }
  if (target === DiscountTarget.PRODUCT) {
    return input.productId ?? existing.productId;
  }
  return null;
}

function resolveCategoryIdForTarget(
  target: DiscountTarget,
  existing: DiscountRecord,
  input: UpdateDiscountInput,
): string | null {
  if (target === DiscountTarget.ORDER) {
    return input.categoryId ?? null;
  }
  if (target === DiscountTarget.CATEGORY) {
    return input.categoryId ?? existing.categoryId;
  }
  return null;
}

function discountChangedFields(
  before: DiscountRecord,
  after: DiscountRecord,
): string[] {
  const fields: string[] = [];
  const scalarFields = [
    'name',
    'type',
    'target',
    'percentValue',
    'fixedAmount',
    'productId',
    'categoryId',
    'isActive',
    'precedence',
    'maxQuantityPerCustomer',
  ] as const;
  for (const field of scalarFields) {
    if (before[field] !== after[field]) fields.push(field);
  }
  if (before.startsAt?.getTime() !== after.startsAt?.getTime()) {
    fields.push('startsAt');
  }
  if (before.endsAt?.getTime() !== after.endsAt?.getTime()) {
    fields.push('endsAt');
  }
  return fields;
}

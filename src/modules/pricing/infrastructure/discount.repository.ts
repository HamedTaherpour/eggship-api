import { Injectable } from '@nestjs/common';
import { toSkipTake, type PageResult } from '../../../common/list';
import { Prisma } from '../../../generated/prisma/client';
import { resolvePrismaConnection } from '../../../infrastructure/database/prisma/prisma-transaction-context';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import type {
  DiscountListQuery,
  DiscountRecord,
  DiscountSortField,
  DiscountPayload,
} from '../domain/discount';
import { DiscountTarget, DiscountType } from '../domain/discount';

type PrismaDiscount = {
  id: string;
  name: string;
  type: DiscountType;
  target: DiscountTarget;
  percentValue: number | null;
  fixedAmount: number | null;
  productId: string | null;
  categoryId: string | null;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  precedence: number;
  createdAt: Date;
  updatedAt: Date;
};

const SORT_FIELD_MAP: Record<
  DiscountSortField,
  keyof Pick<PrismaDiscount, 'name' | 'createdAt' | 'updatedAt' | 'precedence'>
> = {
  name: 'name',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  precedence: 'precedence',
};

/**
 * Narrow persistence boundary for Discount. Prisma types stay here.
 */
@Injectable()
export class DiscountRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<DiscountRecord | null> {
    const found = await this.prisma.discount.findUnique({ where: { id } });
    return found === null ? null : mapDiscount(found);
  }

  /**
   * Candidate discounts for one order-pricing evaluation (PRC-05).
   * Loads active ORDER discounts plus PRODUCT/CATEGORY discounts matching the
   * priced line set in a single query. Window eligibility stays in PRC-03.
   */
  async findCandidatesForOrderPricing(
    scope: {
      productIds: readonly string[];
      categoryIds: readonly string[];
    },
    tx?: TransactionContext,
  ): Promise<DiscountRecord[]> {
    const db = resolvePrismaConnection(this.prisma, tx);
    const orFilters: Prisma.DiscountWhereInput[] = [
      { target: DiscountTarget.ORDER },
    ];

    if (scope.productIds.length > 0) {
      orFilters.push({
        target: DiscountTarget.PRODUCT,
        productId: { in: [...scope.productIds] },
      });
    }
    if (scope.categoryIds.length > 0) {
      orFilters.push({
        target: DiscountTarget.CATEGORY,
        categoryId: { in: [...scope.categoryIds] },
      });
    }

    const rows = await db.discount.findMany({
      where: {
        isActive: true,
        OR: orFilters,
      },
    });
    return rows.map(mapDiscount);
  }

  async list(query: DiscountListQuery): Promise<PageResult<DiscountRecord>> {
    const where = buildWhere(query);
    const { skip, take } = toSkipTake({
      page: query.page,
      pageSize: query.pageSize,
    });
    const orderField = SORT_FIELD_MAP[query.sortBy];

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.discount.count({ where }),
      this.prisma.discount.findMany({
        where,
        orderBy: [{ [orderField]: query.sortOrder }, { id: query.sortOrder }],
        skip,
        take,
      }),
    ]);

    return { items: rows.map(mapDiscount), total };
  }

  async create(payload: DiscountPayload): Promise<DiscountRecord> {
    const created = await this.prisma.discount.create({
      data: mapPayloadToCreate(payload),
    });
    return mapDiscount(created);
  }

  async update(
    id: string,
    payload: DiscountPayload,
  ): Promise<DiscountRecord | null> {
    try {
      const updated = await this.prisma.discount.update({
        where: { id },
        data: mapPayloadToUpdate(payload),
      });
      return mapDiscount(updated);
    } catch (error: unknown) {
      if (isRecordNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }
}

function buildWhere(query: DiscountListQuery): Prisma.DiscountWhereInput {
  const where: Prisma.DiscountWhereInput = {};

  if (query.isActive !== undefined) {
    where.isActive = query.isActive;
  }
  if (query.type !== undefined) {
    where.type = query.type;
  }
  if (query.target !== undefined) {
    where.target = query.target;
  }
  if (query.search !== undefined) {
    where.name = { contains: query.search, mode: 'insensitive' };
  }

  return where;
}

function mapPayloadToCreate(
  payload: DiscountPayload,
): Prisma.DiscountCreateInput {
  return {
    name: payload.name,
    type: payload.type,
    target: payload.target,
    percentValue: payload.percentValue,
    fixedAmount: payload.fixedAmount,
    product: payload.productId
      ? { connect: { id: payload.productId } }
      : undefined,
    category: payload.categoryId
      ? { connect: { id: payload.categoryId } }
      : undefined,
    isActive: payload.isActive,
    startsAt: payload.startsAt,
    endsAt: payload.endsAt,
    precedence: payload.precedence,
  };
}

function mapPayloadToUpdate(
  payload: DiscountPayload,
): Prisma.DiscountUpdateInput {
  return {
    name: payload.name,
    type: payload.type,
    target: payload.target,
    percentValue: payload.percentValue,
    fixedAmount: payload.fixedAmount,
    product:
      payload.target === DiscountTarget.PRODUCT && payload.productId
        ? { connect: { id: payload.productId } }
        : { disconnect: true },
    category:
      payload.target === DiscountTarget.CATEGORY && payload.categoryId
        ? { connect: { id: payload.categoryId } }
        : { disconnect: true },
    isActive: payload.isActive,
    startsAt: payload.startsAt,
    endsAt: payload.endsAt,
    precedence: payload.precedence,
  };
}

function mapDiscount(row: PrismaDiscount): DiscountRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    target: row.target,
    percentValue: row.percentValue,
    fixedAmount: row.fixedAmount,
    productId: row.productId,
    categoryId: row.categoryId,
    isActive: row.isActive,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    precedence: row.precedence,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isRecordNotFoundError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
  );
}

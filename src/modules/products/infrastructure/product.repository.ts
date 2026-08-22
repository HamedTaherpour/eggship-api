import { Injectable } from '@nestjs/common';
import { toSkipTake, type PageResult } from '../../../common/list';
import { Prisma } from '../../../generated/prisma/client';
import { resolvePrismaConnection } from '../../../infrastructure/database/prisma/prisma-transaction-context';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import type {
  CreateProductInput,
  ProductListQuery,
  ProductRecord,
  ProductSortField,
  UpdateProductInput,
} from '../domain/product';
import { ProductInvalidCategoryError } from '../domain/product-errors';
import { normalizeProductName } from '../domain/product-name';
import { normalizeProductPrice } from '../domain/product-price';

type PrismaProduct = {
  id: string;
  name: string;
  price: number;
  categoryId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const SORT_FIELD_MAP: Record<
  ProductSortField,
  keyof Pick<PrismaProduct, 'name' | 'price' | 'createdAt' | 'updatedAt'>
> = {
  name: 'name',
  price: 'price',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

/**
 * Narrow persistence boundary for Product. Prisma types stay here.
 * List/detail mapping never issues per-row Category queries (N+1-safe).
 */
@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<ProductRecord | null> {
    const found = await this.prisma.product.findUnique({ where: { id } });
    return found === null ? null : mapProduct(found);
  }

  /**
   * Public storefront detail: active product whose Category is also active.
   */
  async findPublicById(id: string): Promise<ProductRecord | null> {
    const found = await this.prisma.product.findFirst({
      where: {
        id,
        isActive: true,
        category: { isActive: true },
      },
    });
    return found === null ? null : mapProduct(found);
  }

  async list(query: ProductListQuery): Promise<PageResult<ProductRecord>> {
    const where = buildWhere(query);
    const { skip, take } = toSkipTake({
      page: query.page,
      pageSize: query.pageSize,
    });
    const orderField = SORT_FIELD_MAP[query.sortBy];

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { [orderField]: query.sortOrder },
        skip,
        take,
      }),
    ]);

    return { items: rows.map(mapProduct), total };
  }

  async create(
    input: CreateProductInput,
    tx?: TransactionContext,
  ): Promise<ProductRecord> {
    const name = normalizeProductName(input.name);
    const price = normalizeProductPrice(input.price);
    const db = resolvePrismaConnection(this.prisma, tx);

    try {
      const created = await db.product.create({
        data: {
          name,
          price,
          categoryId: input.categoryId,
          isActive: input.isActive ?? true,
        },
      });
      return mapProduct(created);
    } catch (error: unknown) {
      throwIfInvalidCategoryFk(error);
      throw error;
    }
  }

  async findByIdForUpdate(
    id: string,
    tx: TransactionContext,
  ): Promise<ProductRecord | null> {
    const db = resolvePrismaConnection(this.prisma, tx);
    const rows = await db.$queryRaw<PrismaProduct[]>(Prisma.sql`
      SELECT
        "id",
        "name",
        "price",
        "categoryId",
        "isActive",
        "createdAt",
        "updatedAt"
      FROM "Product"
      WHERE "id" = ${id}::uuid
      FOR UPDATE
    `);
    return rows.length === 1 ? mapProduct(rows[0]!) : null;
  }

  /**
   * Updates current price only. Callers must route admin price changes through
   * PricingService so PriceHistory stays consistent (PRC-01).
   */
  async updatePrice(
    id: string,
    price: number,
    tx: TransactionContext,
  ): Promise<ProductRecord | null> {
    const normalized = normalizeProductPrice(price);
    const db = resolvePrismaConnection(this.prisma, tx);
    try {
      const updated = await db.product.update({
        where: { id },
        data: { price: normalized },
      });
      return mapProduct(updated);
    } catch (error: unknown) {
      if (isRecordNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async update(
    id: string,
    input: UpdateProductInput,
    tx?: TransactionContext,
  ): Promise<ProductRecord | null> {
    const data: Prisma.ProductUpdateInput = {};
    if (input.name !== undefined) {
      data.name = normalizeProductName(input.name);
    }
    if (input.categoryId !== undefined) {
      data.category = { connect: { id: input.categoryId } };
    }
    if (input.isActive !== undefined) {
      data.isActive = input.isActive;
    }

    if (Object.keys(data).length === 0) {
      return this.findById(id);
    }

    const db = resolvePrismaConnection(this.prisma, tx);
    try {
      const updated = await db.product.update({
        where: { id },
        data,
      });
      return mapProduct(updated);
    } catch (error: unknown) {
      if (isRecordNotFoundError(error)) {
        return null;
      }
      throwIfInvalidCategoryFk(error);
      throw error;
    }
  }
}

function buildWhere(query: ProductListQuery): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {};

  if (query.isActive !== undefined) {
    where.isActive = query.isActive;
  }

  if (query.categoryId !== undefined) {
    where.categoryId = query.categoryId;
  }

  if (query.search !== undefined) {
    where.name = { contains: query.search, mode: 'insensitive' };
  }

  if (query.requireActiveCategory === true) {
    where.category = { isActive: true };
  }

  return where;
}

/** Exported for unit tests of list where mapping (Prisma-neutral intent). */
export function buildProductListWhereForTest(
  query: ProductListQuery,
): Prisma.ProductWhereInput {
  return buildWhere(query);
}

function mapProduct(row: PrismaProduct): ProductRecord {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    categoryId: row.categoryId,
    isActive: row.isActive,
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

function throwIfInvalidCategoryFk(error: unknown): void {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2003'
  ) {
    throw new ProductInvalidCategoryError(
      'Category does not exist for this product.',
    );
  }
}

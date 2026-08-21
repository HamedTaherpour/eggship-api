import { Injectable } from '@nestjs/common';
import { toSkipTake, type PageResult } from '../../../common/list';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type {
  CategoryListQuery,
  CategoryRecord,
  CategorySortField,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '../domain/category';
import { normalizeCategoryName } from '../domain/category-name';

type PrismaCategory = {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const SORT_FIELD_MAP: Record<
  CategorySortField,
  keyof Pick<PrismaCategory, 'name' | 'createdAt' | 'updatedAt'>
> = {
  name: 'name',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

/**
 * Narrow persistence boundary for Category. Prisma types stay here.
 */
@Injectable()
export class CategoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<CategoryRecord | null> {
    const found = await this.prisma.category.findUnique({ where: { id } });
    return found === null ? null : mapCategory(found);
  }

  /** Active categories only, ordered by name ascending (public storefront list). */
  async listActiveOrderedByName(): Promise<CategoryRecord[]> {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return rows.map(mapCategory);
  }

  async list(query: CategoryListQuery): Promise<PageResult<CategoryRecord>> {
    const where = buildWhere(query);
    const { skip, take } = toSkipTake({
      page: query.page,
      pageSize: query.pageSize,
    });
    const orderField = SORT_FIELD_MAP[query.sortBy];

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.category.count({ where }),
      this.prisma.category.findMany({
        where,
        orderBy: { [orderField]: query.sortOrder },
        skip,
        take,
      }),
    ]);

    return { items: rows.map(mapCategory), total };
  }

  async create(input: CreateCategoryInput): Promise<CategoryRecord> {
    const name = normalizeCategoryName(input.name);
    const created = await this.prisma.category.create({
      data: {
        name,
        isActive: input.isActive ?? true,
      },
    });
    return mapCategory(created);
  }

  async update(
    id: string,
    input: UpdateCategoryInput,
  ): Promise<CategoryRecord | null> {
    const data: Prisma.CategoryUpdateInput = {};
    if (input.name !== undefined) {
      data.name = normalizeCategoryName(input.name);
    }
    if (input.isActive !== undefined) {
      data.isActive = input.isActive;
    }

    if (Object.keys(data).length === 0) {
      return this.findById(id);
    }

    try {
      const updated = await this.prisma.category.update({
        where: { id },
        data,
      });
      return mapCategory(updated);
    } catch (error: unknown) {
      if (isRecordNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }
}

function buildWhere(query: CategoryListQuery): Prisma.CategoryWhereInput {
  const where: Prisma.CategoryWhereInput = {};

  if (query.isActive !== undefined) {
    where.isActive = query.isActive;
  }

  if (query.search !== undefined) {
    where.name = { contains: query.search, mode: 'insensitive' };
  }

  return where;
}

function mapCategory(row: PrismaCategory): CategoryRecord {
  return {
    id: row.id,
    name: row.name,
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

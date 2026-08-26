import { Injectable } from '@nestjs/common';
import { toSkipTake, type PageResult } from '../../../common/list';
import { Prisma } from '../../../generated/prisma/client';
import { resolvePrismaConnection } from '../../../infrastructure/database/prisma/prisma-transaction-context';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import type {
  CreateRegionInput,
  RegionListQuery,
  RegionRecord,
  RegionSortField,
  UpdateRegionInput,
} from '../domain/region';
import { normalizeRegionName } from '../domain/region-name';

type PrismaRegion = {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const SORT_FIELD_MAP: Record<
  RegionSortField,
  keyof Pick<PrismaRegion, 'name' | 'createdAt' | 'updatedAt'>
> = {
  name: 'name',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

/**
 * Narrow persistence boundary for Region. Prisma types stay here.
 */
@Injectable()
export class RegionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(
    id: string,
    tx?: TransactionContext,
  ): Promise<RegionRecord | null> {
    const db = resolvePrismaConnection(this.prisma, tx);
    const found = await db.region.findUnique({ where: { id } });
    return found === null ? null : mapRegion(found);
  }

  /** Active regions only, ordered by name ascending (public storefront list). */
  async listActiveOrderedByName(): Promise<RegionRecord[]> {
    const rows = await this.prisma.region.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return rows.map(mapRegion);
  }

  async list(query: RegionListQuery): Promise<PageResult<RegionRecord>> {
    const where = buildWhere(query);
    const { skip, take } = toSkipTake({
      page: query.page,
      pageSize: query.pageSize,
    });
    const orderField = SORT_FIELD_MAP[query.sortBy];

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.region.count({ where }),
      this.prisma.region.findMany({
        where,
        orderBy: { [orderField]: query.sortOrder },
        skip,
        take,
      }),
    ]);

    return { items: rows.map(mapRegion), total };
  }

  async create(input: CreateRegionInput): Promise<RegionRecord> {
    const name = normalizeRegionName(input.name);
    const created = await this.prisma.region.create({
      data: {
        name,
        isActive: input.isActive ?? true,
      },
    });
    return mapRegion(created);
  }

  async update(
    id: string,
    input: UpdateRegionInput,
  ): Promise<RegionRecord | null> {
    const data: Prisma.RegionUpdateInput = {};
    if (input.name !== undefined) {
      data.name = normalizeRegionName(input.name);
    }
    if (input.isActive !== undefined) {
      data.isActive = input.isActive;
    }

    if (Object.keys(data).length === 0) {
      return this.findById(id);
    }

    try {
      const updated = await this.prisma.region.update({
        where: { id },
        data,
      });
      return mapRegion(updated);
    } catch (error: unknown) {
      if (isRecordNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }
}

function buildWhere(query: RegionListQuery): Prisma.RegionWhereInput {
  const where: Prisma.RegionWhereInput = {};

  if (query.isActive !== undefined) {
    where.isActive = query.isActive;
  }

  if (query.search !== undefined) {
    where.name = { contains: query.search, mode: 'insensitive' };
  }

  return where;
}

function mapRegion(row: PrismaRegion): RegionRecord {
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

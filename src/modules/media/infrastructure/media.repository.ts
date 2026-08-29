import { Injectable } from '@nestjs/common';
import { toSkipTake, type PageResult } from '../../../common/list';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import {
  resolvePrismaConnection,
  type PrismaConnection,
} from '../../../infrastructure/database/prisma/prisma-transaction-context';
import type { AcceptedMediaMimeType } from '../domain/accepted-media-types';
import type {
  CreateMediaInput,
  MediaListQuery,
  MediaRecord,
  MediaSortField,
} from '../domain/media';

type PrismaMedia = {
  id: string;
  storageKey: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: Date;
  updatedAt: Date;
};

const SORT_FIELD_MAP: Record<
  MediaSortField,
  keyof Pick<PrismaMedia, 'createdAt' | 'originalFileName' | 'sizeBytes'>
> = {
  createdAt: 'createdAt',
  originalFileName: 'originalFileName',
  sizeBytes: 'sizeBytes',
};

@Injectable()
export class MediaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<MediaRecord | null> {
    const found = await this.prisma.media.findUnique({ where: { id } });
    return found === null ? null : mapMedia(found);
  }

  async findByIds(ids: readonly string[]): Promise<MediaRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.media.findMany({
      where: { id: { in: [...ids] } },
    });
    return rows.map(mapMedia);
  }

  async findByIdForReference(
    id: string,
    tx: TransactionContext,
  ): Promise<MediaRecord | null> {
    const rows = await this.db(tx).$queryRaw<PrismaMedia[]>(Prisma.sql`
      SELECT "id", "storageKey", "originalFileName", "mimeType", "sizeBytes",
             "width", "height", "createdAt", "updatedAt"
      FROM "Media"
      WHERE "id" = ${id}::uuid
      FOR UPDATE
    `);
    return rows[0] === undefined ? null : mapMedia(rows[0]);
  }

  async isReferenced(id: string, tx?: TransactionContext): Promise<boolean> {
    const db = this.db(tx);
    const found = await db.$queryRaw<Array<{ referenced: boolean }>>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1 FROM "Product" WHERE "imageMediaId" = ${id}::uuid
        UNION ALL SELECT 1 FROM "Blog" WHERE "coverMediaId" = ${id}::uuid
        UNION ALL SELECT 1 FROM "BlogAuthor" WHERE "avatarMediaId" = ${id}::uuid
        UNION ALL SELECT 1 FROM "BlogInlineMedia" WHERE "mediaId" = ${id}::uuid
        UNION ALL SELECT 1 FROM "OrderSettlement" WHERE "receiptMediaId" = ${id}::uuid
      ) AS referenced
    `);
    return rowsBoolean(found[0]?.referenced);
  }

  async isReferencedBySettlement(id: string): Promise<boolean> {
    const found = await this.prisma.orderSettlement.findFirst({
      where: { receiptMediaId: id },
      select: { id: true },
    });
    return found !== null;
  }

  async usages(
    id: string,
    tx?: TransactionContext,
  ): Promise<Array<{ type: string; id: string }>> {
    const rows = await this.db(tx).$queryRaw<
      Array<{ type: string; id: string }>
    >(Prisma.sql`
      SELECT 'PRODUCT_IMAGE' AS type, "id" FROM "Product" WHERE "imageMediaId" = ${id}::uuid
      UNION ALL SELECT 'BLOG_COVER', "id" FROM "Blog" WHERE "coverMediaId" = ${id}::uuid
      UNION ALL SELECT 'BLOG_AUTHOR_AVATAR', "id" FROM "BlogAuthor" WHERE "avatarMediaId" = ${id}::uuid
      UNION ALL SELECT 'BLOG_INLINE', "blogId" FROM "BlogInlineMedia" WHERE "mediaId" = ${id}::uuid
      UNION ALL SELECT 'SETTLEMENT_RECEIPT', "id" FROM "OrderSettlement" WHERE "receiptMediaId" = ${id}::uuid
      ORDER BY type, id
    `);
    return rows;
  }

  async list(query: MediaListQuery): Promise<PageResult<MediaRecord>> {
    const where = buildWhere(query);
    const { skip, take } = toSkipTake({
      page: query.page,
      pageSize: query.pageSize,
    });
    const orderField = SORT_FIELD_MAP[query.sortBy];

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.media.count({ where }),
      this.prisma.media.findMany({
        where,
        orderBy: { [orderField]: query.sortOrder },
        skip,
        take,
      }),
    ]);

    return { items: rows.map(mapMedia), total };
  }

  async create(input: CreateMediaInput): Promise<MediaRecord> {
    const created = await this.prisma.media.create({
      data: {
        storageKey: input.storageKey,
        originalFileName: input.originalFileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        width: input.width,
        height: input.height,
      },
    });
    return mapMedia(created);
  }

  async deleteById(
    id: string,
    tx?: TransactionContext,
  ): Promise<MediaRecord | null> {
    try {
      const deleted = await this.db(tx).media.delete({ where: { id } });
      return mapMedia(deleted);
    } catch (error: unknown) {
      if (isRecordNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  private db(tx?: TransactionContext): PrismaConnection {
    return resolvePrismaConnection(this.prisma, tx);
  }
}

function rowsBoolean(value: boolean | undefined): boolean {
  return value === true;
}

function buildWhere(query: MediaListQuery): Prisma.MediaWhereInput {
  const where: Prisma.MediaWhereInput = {};

  if (query.mimeType !== undefined) {
    where.mimeType = query.mimeType;
  }

  if (query.search !== undefined) {
    where.originalFileName = { contains: query.search, mode: 'insensitive' };
  }

  if (query.createdFrom !== undefined || query.createdTo !== undefined) {
    where.createdAt = {
      ...(query.createdFrom === undefined ? {} : { gte: query.createdFrom }),
      ...(query.createdTo === undefined ? {} : { lte: query.createdTo }),
    };
  }

  return where;
}

/** Exported for unit tests of list where mapping (Prisma-neutral intent). */
export function buildMediaListWhereForTest(
  query: MediaListQuery,
): Prisma.MediaWhereInput {
  return buildWhere(query);
}

function mapMedia(row: PrismaMedia): MediaRecord {
  return {
    id: row.id,
    storageKey: row.storageKey,
    originalFileName: row.originalFileName,
    mimeType: row.mimeType as AcceptedMediaMimeType,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
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

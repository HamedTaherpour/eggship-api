import { Injectable } from '@nestjs/common';
import { toSkipTake, type PageResult } from '../../../common/list';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
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

  async deleteById(id: string): Promise<MediaRecord | null> {
    try {
      const deleted = await this.prisma.media.delete({ where: { id } });
      return mapMedia(deleted);
    } catch (error: unknown) {
      if (isRecordNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }
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

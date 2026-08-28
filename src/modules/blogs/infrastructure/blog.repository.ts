import { Injectable } from '@nestjs/common';
import { toSkipTake, type PageResult } from '../../../common/list';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type {
  BlogListQuery,
  BlogRecord,
  BlogSortField,
  CreateBlogInput,
} from '../domain/blog';
import { normalizeBlogBody } from '../domain/blog-body';
import { BlogSlugConflictError } from '../domain/blog-errors';
import {
  resolveBlogPublication,
  publishedBlogWhere,
} from '../domain/blog-publication';
import { normalizeBlogSlug } from '../domain/blog-slug';
import { normalizeBlogTitle } from '../domain/blog-title';

type PrismaBlog = {
  id: string;
  slug: string;
  title: string;
  body: string;
  isPublished: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const SORT_FIELD_MAP: Record<
  BlogSortField,
  keyof Pick<PrismaBlog, 'publishedAt' | 'title' | 'createdAt'>
> = {
  publishedAt: 'publishedAt',
  title: 'title',
  createdAt: 'createdAt',
};

/**
 * Narrow persistence boundary for Blog. Prisma types stay here.
 * Public list/detail always apply {@link publishedBlogWhere} so drafts cannot
 * leak through counts, search, or slug lookup.
 */
@Injectable()
export class BlogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPublishedBySlug(slug: string): Promise<BlogRecord | null> {
    const found = await this.prisma.blog.findFirst({
      where: {
        slug: normalizeBlogSlug(slug),
        ...publishedBlogWhere(),
      },
    });
    return found === null ? null : mapBlog(found);
  }

  async list(query: BlogListQuery): Promise<PageResult<BlogRecord>> {
    const where = buildWhere(query);
    const { skip, take } = toSkipTake({
      page: query.page,
      pageSize: query.pageSize,
    });
    const orderField = SORT_FIELD_MAP[query.sortBy];

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.blog.count({ where }),
      this.prisma.blog.findMany({
        where,
        orderBy: [{ [orderField]: query.sortOrder }, { id: query.sortOrder }],
        skip,
        take,
      }),
    ]);

    return { items: rows.map(mapBlog), total };
  }

  /**
   * Persistence helper for tests and CNT-02. No public write HTTP in CNT-01.
   */
  async create(input: CreateBlogInput): Promise<BlogRecord> {
    const slug = normalizeBlogSlug(input.slug);
    const title = normalizeBlogTitle(input.title);
    const body = normalizeBlogBody(input.body);
    const publication = resolveBlogPublication({
      isPublished: input.isPublished ?? false,
      publishedAt: input.publishedAt,
    });

    try {
      const created = await this.prisma.blog.create({
        data: {
          slug,
          title,
          body,
          isPublished: publication.isPublished,
          publishedAt: publication.publishedAt,
        },
      });
      return mapBlog(created);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new BlogSlugConflictError();
      }
      throw error;
    }
  }
}

function buildWhere(query: BlogListQuery): Prisma.BlogWhereInput {
  const where: Prisma.BlogWhereInput = {};

  if (query.publishedOnly === true) {
    Object.assign(where, publishedBlogWhere());
  }

  if (query.search !== undefined) {
    where.title = { contains: query.search, mode: 'insensitive' };
  }

  return where;
}

/** Exported for unit tests of list where mapping (Prisma-neutral intent). */
export function buildBlogListWhereForTest(
  query: BlogListQuery,
): Prisma.BlogWhereInput {
  return buildWhere(query);
}

function mapBlog(row: PrismaBlog): BlogRecord {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    isPublished: row.isPublished,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

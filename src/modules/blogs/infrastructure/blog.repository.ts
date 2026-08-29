import { Injectable } from '@nestjs/common';
import { toSkipTake, type PageResult } from '../../../common/list';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type {
  BlogListQuery,
  BlogRecord,
  BlogSortField,
  CreateBlogInput,
  UpdateBlogInput,
} from '../domain/blog';
import {
  BlogAuthorInactiveError,
  BlogAuthorNotFoundError,
  BlogCategoryNotFoundError,
  BlogSlugConflictError,
  BlogTagNotFoundError,
} from '../domain/blog-errors';
import {
  applyPublishTransition,
  applyUnpublishTransition,
  resolveBlogPublication,
  publishedBlogWhere,
} from '../domain/blog-publication';
import { normalizeBlogSlug } from '../domain/blog-slug';
import { normalizeBlogTitle } from '../domain/blog-title';
import { normalizeOptionalBlogText } from '../domain/blog-field';
import { validateBlogMarkdown } from '../domain/blog-markdown';

type PrismaBlog = {
  id: string;
  slug: string;
  title: string;
  body: string;
  authorId: string | null;
  excerpt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  author: {
    id: string;
    name: string;
    slug: string;
    bio: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  categories: {
    category: {
      id: string;
      name: string;
      slug: string;
      description: string | null;
      isActive: boolean;
    };
  }[];
  tags: {
    tag: { id: string; name: string; slug: string; description: string | null };
  }[];
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
      include: blogInclude,
    });
    return found === null ? null : mapBlog(found);
  }

  /** Public storefront list: published rows only. */
  async listPublished(query: BlogListQuery): Promise<PageResult<BlogRecord>> {
    return this.listWithWhere(query, publishedBlogWhere());
  }

  /** Unrestricted list for internal/admin callers (CNT-02). */
  async listAll(query: BlogListQuery): Promise<PageResult<BlogRecord>> {
    return this.listWithWhere(query, {});
  }

  /** Admin detail: drafts and published rows by primary key. */
  async findById(id: string): Promise<BlogRecord | null> {
    const found = await this.prisma.blog.findUnique({
      where: { id },
      include: blogInclude,
    });
    return found === null ? null : mapBlog(found);
  }

  /**
   * Persistence helper for tests and CNT-02. No public write HTTP in CNT-01.
   */
  async create(input: CreateBlogInput): Promise<BlogRecord> {
    const slug = normalizeBlogSlug(input.slug);
    const title = normalizeBlogTitle(input.title);
    const body = validateBlogMarkdown(input.body);
    const publication = resolveBlogPublication({
      isPublished: input.isPublished ?? false,
      publishedAt: input.publishedAt,
    });
    const categoryIds = [...new Set(input.categoryIds ?? [])];
    const tagIds = [...new Set(input.tagIds ?? [])];

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await this.validateAssociations(
          tx,
          input.authorId,
          categoryIds,
          tagIds,
        );
        return tx.blog.create({
          data: {
            slug,
            title,
            body,
            isPublished: publication.isPublished,
            publishedAt: publication.publishedAt,
            excerpt: normalizeOptionalBlogText(input.excerpt, 'Excerpt', 320),
            seoTitle: normalizeOptionalBlogText(
              input.seoTitle,
              'SEO title',
              200,
            ),
            seoDescription: normalizeOptionalBlogText(
              input.seoDescription,
              'SEO description',
              320,
            ),
            ...(input.authorId
              ? { author: { connect: { id: input.authorId } } }
              : {}),
            ...(input.categoryIds
              ? {
                  categories: {
                    create: categoryIds.map((categoryId) => ({
                      category: { connect: { id: categoryId } },
                    })),
                  },
                }
              : {}),
            ...(input.tagIds
              ? {
                  tags: {
                    create: tagIds.map((tagId) => ({
                      tag: { connect: { id: tagId } },
                    })),
                  },
                }
              : {}),
          },
          include: blogInclude,
        });
      });
      return mapBlog(created);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new BlogSlugConflictError();
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateBlogInput): Promise<BlogRecord | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Blog -> Author -> Category -> Tag is the lock order for Blog mutations.
        await tx.$queryRaw`SELECT "id" FROM "Blog" WHERE "id" = ${id} FOR UPDATE`;
        const existing = await tx.blog.findUnique({
          where: { id },
          include: blogInclude,
        });
        if (existing === null) return null;
        const categoryIds =
          input.categoryIds === undefined
            ? undefined
            : [...new Set(input.categoryIds)];
        const tagIds =
          input.tagIds === undefined ? undefined : [...new Set(input.tagIds)];
        await this.validateAssociations(
          tx,
          input.authorId,
          categoryIds,
          tagIds,
        );
        if (existing.isPublished && input.authorId === null)
          throw new BlogAuthorNotFoundError();

        const data: Prisma.BlogUpdateInput = {};
        if (input.slug !== undefined) data.slug = normalizeBlogSlug(input.slug);
        if (input.title !== undefined)
          data.title = normalizeBlogTitle(input.title);
        if (input.body !== undefined)
          data.body = validateBlogMarkdown(input.body);
        if (input.excerpt !== undefined)
          data.excerpt = normalizeOptionalBlogText(
            input.excerpt,
            'Excerpt',
            320,
          );
        if (input.seoTitle !== undefined)
          data.seoTitle = normalizeOptionalBlogText(
            input.seoTitle,
            'SEO title',
            200,
          );
        if (input.seoDescription !== undefined)
          data.seoDescription = normalizeOptionalBlogText(
            input.seoDescription,
            'SEO description',
            320,
          );
        if (input.authorId !== undefined)
          data.author =
            input.authorId === null
              ? { disconnect: true }
              : { connect: { id: input.authorId } };
        if (categoryIds !== undefined)
          data.categories = {
            deleteMany: {},
            create: categoryIds.map((categoryId) => ({
              category: { connect: { id: categoryId } },
            })),
          };
        if (tagIds !== undefined)
          data.tags = {
            deleteMany: {},
            create: tagIds.map((tagId) => ({
              tag: { connect: { id: tagId } },
            })),
          };
        if (Object.keys(data).length === 0) return mapBlog(existing);
        const updated = await tx.blog.update({
          where: { id },
          data,
          include: blogInclude,
        });
        return mapBlog(updated);
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new BlogSlugConflictError();
      }
      throw error;
    }
  }

  publish(id: string, now: Date): Promise<BlogRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      // Blog -> Author is the lock order for publication.
      await tx.$queryRaw`SELECT "id" FROM "Blog" WHERE "id" = ${id} FOR UPDATE`;
      const existing = await tx.blog.findUnique({
        where: { id },
        include: blogInclude,
      });
      if (existing === null) return null;
      if (existing.authorId === null) throw new BlogAuthorNotFoundError();
      await tx.$queryRaw`SELECT "id" FROM "BlogAuthor" WHERE "id" = ${existing.authorId} FOR UPDATE`;
      const author = await tx.blogAuthor.findUnique({
        where: { id: existing.authorId },
      });
      if (author === null) throw new BlogAuthorNotFoundError();
      if (!author.isActive) throw new BlogAuthorInactiveError();
      const publication = applyPublishTransition(existing, now);
      const updated = await tx.blog.update({
        where: { id },
        data: publication,
        include: blogInclude,
      });
      return mapBlog(updated);
    });
  }

  async unpublish(id: string): Promise<BlogRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      // Blog is the first lock for every Blog mutation.
      await tx.$queryRaw`SELECT "id" FROM "Blog" WHERE "id" = ${id} FOR UPDATE`;
      const existing = await tx.blog.findUnique({
        where: { id },
        include: blogInclude,
      });
      if (existing === null) return null;

      const publication = applyUnpublishTransition(existing);
      const updated = await tx.blog.update({
        where: { id },
        data: publication,
        include: blogInclude,
      });
      return mapBlog(updated);
    });
  }

  private async listWithWhere(
    query: BlogListQuery,
    visibility: Prisma.BlogWhereInput,
  ): Promise<PageResult<BlogRecord>> {
    const where = buildWhere(query, visibility);
    const { skip, take } = toSkipTake({
      page: query.page,
      pageSize: query.pageSize,
    });
    const orderField = SORT_FIELD_MAP[query.sortBy];

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.blog.count({ where }),
      this.prisma.blog.findMany({
        where,
        include: blogInclude,
        orderBy: [{ [orderField]: query.sortOrder }, { id: query.sortOrder }],
        skip,
        take,
      }),
    ]);

    return { items: rows.map(mapBlog), total };
  }

  private async validateAssociations(
    tx: Prisma.TransactionClient,
    authorId?: string | null,
    categoryIds?: string[],
    tagIds?: string[],
  ): Promise<void> {
    if (authorId !== undefined && authorId !== null) {
      const locked = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "BlogAuthor" WHERE "id" = ${authorId} FOR UPDATE`;
      const author =
        locked.length === 0
          ? null
          : await tx.blogAuthor.findUnique({ where: { id: authorId } });
      if (author === null) throw new BlogAuthorNotFoundError();
      if (!author.isActive) throw new BlogAuthorInactiveError();
    }
    if (categoryIds !== undefined && categoryIds.length > 0) {
      const ids = [...new Set(categoryIds)].sort();
      const locked = await tx.$queryRaw<
        Array<{ id: string; isActive: boolean }>
      >`SELECT "id", "isActive" FROM "BlogCategory" WHERE "id" IN (${Prisma.join(ids)}) FOR UPDATE`;
      const count = locked.filter((category) => category.isActive).length;
      if (count !== new Set(categoryIds).size)
        throw new BlogCategoryNotFoundError();
    }
    if (tagIds !== undefined && tagIds.length > 0) {
      const ids = [...new Set(tagIds)].sort();
      const locked = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "BlogTag" WHERE "id" IN (${Prisma.join(ids)}) FOR UPDATE`;
      const count = locked.length;
      if (count !== new Set(tagIds).size) throw new BlogTagNotFoundError();
    }
  }
}

function buildWhere(
  query: BlogListQuery,
  visibility: Prisma.BlogWhereInput,
): Prisma.BlogWhereInput {
  const where: Prisma.BlogWhereInput = { ...visibility };

  if (query.search !== undefined) {
    where.title = { contains: query.search, mode: 'insensitive' };
  }

  if (query.isPublished !== undefined) {
    where.isPublished = query.isPublished;
  }

  return where;
}

/** Exported for unit tests of published list where mapping (Prisma-neutral intent). */
export function buildPublishedBlogListWhereForTest(
  query: BlogListQuery,
): Prisma.BlogWhereInput {
  return buildWhere(query, publishedBlogWhere());
}

/** Exported for unit tests of unrestricted admin list where mapping. */
export function buildAdminBlogListWhereForTest(
  query: BlogListQuery,
): Prisma.BlogWhereInput {
  return buildWhere(query, {});
}

function mapBlog(row: PrismaBlog): BlogRecord {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    excerpt: row.excerpt ?? null,
    seoTitle: row.seoTitle ?? null,
    seoDescription: row.seoDescription ?? null,
    author: row.author ?? null,
    categories: row.categories?.map(({ category }) => category) ?? [],
    tags: row.tags?.map(({ tag }) => tag) ?? [],
    isPublished: row.isPublished,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const blogInclude = {
  author: true,
  categories: {
    include: { category: true },
    orderBy: { category: { name: 'asc' as const } },
  },
  tags: { include: { tag: true }, orderBy: { tag: { name: 'asc' as const } } },
} as const;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

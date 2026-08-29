import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { normalizeBlogSlug } from '../domain/blog-slug';
import {
  BLOG_TAXONOMY_NAME_MAX_LENGTH,
  normalizeOptionalBlogText,
  normalizeRequiredBlogText,
} from '../domain/blog-field';
import {
  BlogTaxonomyConflictError,
  BlogReferencedDeleteError,
} from '../domain/blog-errors';
import { isAcceptedMediaMimeType } from '../../media/domain/accepted-media-types';
import {
  MediaNotFoundError,
  MediaUnsupportedTypeError,
} from '../../media/domain/media-errors';
import { MediaService } from '../../media/application/media.service';

export type TaxonomyKind = 'category' | 'tag' | 'author';
export interface TaxonomyInput {
  name: string;
  slug: string;
  description?: string | null;
  bio?: string | null;
  isActive?: boolean;
  avatarMediaId?: string | null;
}

@Injectable()
export class BlogTaxonomyService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly media?: MediaService,
  ) {}

  async list(kind: TaxonomyKind, activeOnly = false): Promise<object[]> {
    if (kind === 'category')
      return this.prisma.blogCategory.findMany({
        where: activeOnly ? { isActive: true } : {},
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
    if (kind === 'tag')
      return this.prisma.blogTag.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
    const authors = await this.prisma.blogAuthor.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    if (this.media === undefined) return authors;
    const presentations = await this.media.presentations(
      authors.map((author) => author.avatarMediaId),
    );
    return authors.map((author) => ({
      ...author,
      avatar: author.avatarMediaId
        ? (presentations.get(author.avatarMediaId) ?? null)
        : null,
    }));
  }
  async get(kind: TaxonomyKind, id: string): Promise<object | null> {
    if (kind === 'category')
      return this.prisma.blogCategory.findUnique({ where: { id } });
    if (kind === 'tag')
      return this.prisma.blogTag.findUnique({ where: { id } });
    const author = await this.prisma.blogAuthor.findUnique({ where: { id } });
    if (author === null) return null;
    if (this.media === undefined) return author;
    const presentation = await this.media.presentations([author.avatarMediaId]);
    return {
      ...author,
      avatar: author.avatarMediaId
        ? (presentation.get(author.avatarMediaId) ?? null)
        : null,
    };
  }
  async create(kind: TaxonomyKind, input: TaxonomyInput): Promise<object> {
    const common = {
      name: normalizeRequiredBlogText(
        input.name,
        'Name',
        BLOG_TAXONOMY_NAME_MAX_LENGTH,
      ),
      slug: normalizeBlogSlug(input.slug),
    };
    try {
      if (kind === 'category')
        return this.prisma.blogCategory.create({
          data: {
            ...common,
            description: normalizeOptionalBlogText(
              input.description,
              'Description',
              500,
            ),
            isActive: input.isActive ?? true,
          },
        });
      if (kind === 'tag')
        return this.prisma.blogTag.create({
          data: {
            ...common,
            description: normalizeOptionalBlogText(
              input.description,
              'Description',
              500,
            ),
          },
        });
      const author = await this.prisma.$transaction(async (tx) => {
        await lockAndValidateAvatar(tx, input.avatarMediaId);
        return tx.blogAuthor.create({
          data: {
            ...common,
            bio: normalizeOptionalBlogText(input.bio, 'Bio', 2000),
            isActive: input.isActive ?? true,
            avatarMediaId: input.avatarMediaId ?? null,
          },
        });
      });
      return this.withAuthorPresentation(author);
    } catch (error: unknown) {
      if (isUnique(error)) throw new BlogTaxonomyConflictError();
      throw error;
    }
  }
  async update(
    kind: TaxonomyKind,
    id: string,
    input: Partial<TaxonomyInput>,
  ): Promise<object | null> {
    const data: Prisma.BlogCategoryUpdateInput &
      Prisma.BlogTagUpdateInput &
      Prisma.BlogAuthorUpdateInput = {};
    if (input.name !== undefined)
      data.name = normalizeRequiredBlogText(
        input.name,
        'Name',
        BLOG_TAXONOMY_NAME_MAX_LENGTH,
      );
    if (input.slug !== undefined) data.slug = normalizeBlogSlug(input.slug);
    if (input.description !== undefined)
      data.description = normalizeOptionalBlogText(
        input.description,
        'Description',
        500,
      );
    if (input.bio !== undefined)
      data.bio = normalizeOptionalBlogText(input.bio, 'Bio', 2000);
    if (input.isActive !== undefined) data.isActive = input.isActive;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Taxonomy mutations lock their own row. Blog mutations use Blog -> taxonomy;
        // deactivation does not lock Blog rows, so the order cannot cycle.
        const table =
          kind === 'category'
            ? 'BlogCategory'
            : kind === 'tag'
              ? 'BlogTag'
              : 'BlogAuthor';
        const locked = await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT "id" FROM ${Prisma.raw(`"${table}"`)} WHERE "id" = ${id} FOR UPDATE`;
        if (locked.length === 0) return null;
        if (kind === 'category')
          return tx.blogCategory.update({ where: { id }, data });
        if (kind === 'tag') return tx.blogTag.update({ where: { id }, data });
        if (input.avatarMediaId !== undefined) {
          await lockAndValidateAvatar(tx, input.avatarMediaId);
          (data as Prisma.BlogAuthorUpdateInput).avatarMedia =
            input.avatarMediaId === null
              ? { disconnect: true }
              : { connect: { id: input.avatarMediaId } };
        }
        return tx.blogAuthor.update({ where: { id }, data });
      });
      if (result === null || kind !== 'author') return result;
      const author = await this.prisma.blogAuthor.findUnique({ where: { id } });
      return author === null ? null : this.withAuthorPresentation(author);
    } catch (error: unknown) {
      if (isUnique(error)) throw new BlogTaxonomyConflictError();
      if (isForeignKey(error)) throw new BlogReferencedDeleteError();
      throw error;
    }
  }
  async delete(kind: TaxonomyKind, id: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const table =
          kind === 'category'
            ? 'BlogCategory'
            : kind === 'tag'
              ? 'BlogTag'
              : 'BlogAuthor';
        const locked = await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT "id" FROM ${Prisma.raw(`"${table}"`)} WHERE "id" = ${id} FOR UPDATE`;
        if (locked.length === 0) return;
        if (kind === 'category')
          await tx.blogCategory.delete({ where: { id } });
        else if (kind === 'tag') await tx.blogTag.delete({ where: { id } });
        else await tx.blogAuthor.delete({ where: { id } });
      });
    } catch (error: unknown) {
      if (isForeignKey(error)) throw new BlogReferencedDeleteError();
      throw error;
    }
  }

  private async withAuthorPresentation<
    T extends { avatarMediaId: string | null },
  >(author: T): Promise<T & { avatar: object | null }> {
    if (this.media === undefined) return { ...author, avatar: null };
    const presentations = await this.media.presentations([
      author.avatarMediaId,
    ]);
    return {
      ...author,
      avatar: author.avatarMediaId
        ? (presentations.get(author.avatarMediaId) ?? null)
        : null,
    };
  }
}

async function lockAndValidateAvatar(
  tx: Prisma.TransactionClient,
  mediaId: string | null | undefined,
): Promise<void> {
  if (mediaId === undefined || mediaId === null) return;
  const rows = await tx.$queryRaw<Array<{ mimeType: string }>>`
    SELECT "mimeType" FROM "Media" WHERE "id" = ${mediaId}::uuid FOR UPDATE
  `;
  if (rows.length === 0) throw new MediaNotFoundError();
  if (!isAcceptedMediaMimeType(rows[0]!.mimeType))
    throw new MediaUnsupportedTypeError();
}
function isUnique(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
function isForeignKey(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2003' || error.code === 'P2014')
  );
}

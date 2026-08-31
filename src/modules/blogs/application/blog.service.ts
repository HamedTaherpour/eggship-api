import { Injectable, Optional } from '@nestjs/common';
import {
  resolvePageRequest,
  toPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/list';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import {
  TransactionRunner,
  type TransactionContext,
} from '../../../infrastructure/database/transaction';
import { AuditLogService } from '../../audit/application/audit-log.service';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../../audit/domain/audit-event';
import type { BlogRecord, UpdateBlogInput } from '../domain/blog';
import { BlogNotFoundError } from '../domain/blog-errors';
import { normalizeBlogSlug } from '../domain/blog-slug';
import { BlogRepository } from '../infrastructure/blog.repository';
import { MediaService } from '../../media/application/media.service';
import {
  resolvePublicBlogSort,
  type PublicBlogListQueryDto,
} from '../api/dto/public-blog-list-query.dto';
import {
  resolveAdminBlogSort,
  type AdminBlogListQueryDto,
} from '../api/dto/admin-blog-list-query.dto';
import type { CreateBlogBodyDto } from '../api/dto/create-blog.dto';
import type { UpdateBlogBodyDto } from '../api/dto/update-blog.dto';

@Injectable()
export class BlogService {
  constructor(
    private readonly blogs: BlogRepository,
    private readonly logger: ApplicationLogger,
    private readonly transactions: TransactionRunner,
    private readonly audit: AuditLogService,
    @Optional() private readonly media?: MediaService,
  ) {}

  /**
   * Public storefront list: published posts only.
   * Drafts never affect items, search matches, or pagination totals.
   */
  async listPublic(
    query: PublicBlogListQueryDto,
  ): Promise<PaginatedResponse<BlogRecord>> {
    const pageRequest = resolvePageRequest(query);
    const sort = resolvePublicBlogSort(query);
    const page = await this.blogs.listPublished({
      page: pageRequest.page,
      pageSize: pageRequest.pageSize,
      search: query.search,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
    });
    return toPaginatedResponse(
      await this.withMediaPresentations(page.items, false),
      pageRequest,
      page.total,
    );
  }

  async getPublicBySlug(slug: string): Promise<BlogRecord> {
    const canonical = normalizeBlogSlug(slug);
    const found = await this.blogs.findPublishedBySlug(canonical);
    if (found === null) {
      throw new BlogNotFoundError();
    }
    return (await this.withMediaPresentations([found], true))[0]!;
  }

  async listAdmin(
    query: AdminBlogListQueryDto,
  ): Promise<PaginatedResponse<BlogRecord>> {
    const pageRequest = resolvePageRequest(query);
    const sort = resolveAdminBlogSort(query);
    const page = await this.blogs.listAll({
      page: pageRequest.page,
      pageSize: pageRequest.pageSize,
      search: query.search,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
      isPublished: query.isPublished,
    });
    return toPaginatedResponse(
      await this.withMediaPresentations(page.items, false),
      pageRequest,
      page.total,
    );
  }

  async getAdminById(id: string): Promise<BlogRecord> {
    const found = await this.blogs.findById(id);
    if (found === null) {
      throw new BlogNotFoundError();
    }
    return (await this.withMediaPresentations([found], true))[0]!;
  }

  async create(body: CreateBlogBodyDto): Promise<BlogRecord> {
    const created = await this.blogs.create({
      slug: body.slug,
      title: body.title,
      body: body.body,
      isPublished: false,
      excerpt: body.excerpt,
      seoTitle: body.seoTitle,
      seoDescription: body.seoDescription,
      authorId: body.authorId,
      categoryIds: body.categoryIds,
      tagIds: body.tagIds,
      coverMediaId: body.coverMediaId,
    });
    this.logger.info(
      {
        module: 'blogs',
        operation: 'content.blog.created',
        blogId: created.id,
        isPublished: created.isPublished,
      },
      'Blog created',
    );
    return (await this.withMediaPresentations([created], true))[0]!;
  }

  async update(id: string, body: UpdateBlogBodyDto): Promise<BlogRecord> {
    const patch: UpdateBlogInput = {};
    if (body.slug !== undefined) {
      patch.slug = body.slug;
    }
    if (body.title !== undefined) {
      patch.title = body.title;
    }
    if (body.body !== undefined) {
      patch.body = body.body;
    }
    patch.excerpt = body.excerpt;
    patch.seoTitle = body.seoTitle;
    patch.seoDescription = body.seoDescription;
    patch.authorId = body.authorId;
    patch.categoryIds = body.categoryIds;
    patch.tagIds = body.tagIds;
    patch.coverMediaId = body.coverMediaId;

    const updated = await this.blogs.update(id, patch);
    if (updated === null) {
      throw new BlogNotFoundError();
    }

    this.logger.info(
      {
        module: 'blogs',
        operation: 'content.blog.updated',
        blogId: updated.id,
        isPublished: updated.isPublished,
      },
      'Blog updated',
    );
    return (await this.withMediaPresentations([updated], true))[0]!;
  }

  async publish(
    id: string,
    actorId: string,
    now = new Date(),
  ): Promise<BlogRecord> {
    const mutation = await this.transactions.run(async (tx) => {
      const value = await this.blogs.publish(id, now, tx);
      if (value?.changed)
        await this.appendAudit(AuditAction.BLOG_PUBLISHED, id, actorId, tx);
      return value;
    });
    if (mutation === null) {
      throw new BlogNotFoundError();
    }
    const updated = mutation.record;

    this.logger.info(
      {
        module: 'blogs',
        operation: 'content.blog.published',
        blogId: updated.id,
        publishedAt: updated.publishedAt?.toISOString(),
      },
      'Blog published',
    );
    return updated;
  }

  async unpublish(id: string, actorId: string): Promise<BlogRecord> {
    const mutation = await this.transactions.run(async (tx) => {
      const value = await this.blogs.unpublish(id, tx);
      if (value?.changed)
        await this.appendAudit(AuditAction.BLOG_UNPUBLISHED, id, actorId, tx);
      return value;
    });
    if (mutation === null) {
      throw new BlogNotFoundError();
    }
    const updated = mutation.record;

    this.logger.info(
      {
        module: 'blogs',
        operation: 'content.blog.unpublished',
        blogId: updated.id,
        publishedAt: updated.publishedAt?.toISOString() ?? null,
      },
      'Blog unpublished',
    );
    return (await this.withMediaPresentations([updated], true))[0]!;
  }

  private appendAudit(
    action:
      typeof AuditAction.BLOG_PUBLISHED | typeof AuditAction.BLOG_UNPUBLISHED,
    blogId: string,
    actorId: string,
    tx: TransactionContext,
  ): Promise<unknown> {
    return this.audit.append(
      {
        action,
        actorType: AuditActorType.ADMIN,
        actorId,
        entityType: AuditEntityType.BLOG,
        entityId: blogId,
        metadata: undefined,
      },
      tx,
    );
  }

  private async withMediaPresentations(
    records: BlogRecord[],
    includeInline: boolean,
  ): Promise<BlogRecord[]> {
    if (this.media === undefined) return records;
    const ids = records.flatMap((record) => [
      record.coverMediaId,
      record.author?.avatarMediaId,
      ...(includeInline ? (record.inlineMediaIds ?? []) : []),
    ]);
    const presentations = await this.media.presentations(ids);
    return records.map((record) => ({
      ...record,
      cover: record.coverMediaId
        ? (presentations.get(record.coverMediaId) ?? null)
        : null,
      author: record.author
        ? {
            ...record.author,
            avatar: record.author.avatarMediaId
              ? (presentations.get(record.author.avatarMediaId) ?? null)
              : null,
          }
        : null,
      ...(includeInline
        ? {
            inlineMedia: (record.inlineMediaIds ?? [])
              .map((id) => presentations.get(id))
              .filter(
                (media): media is NonNullable<typeof media> =>
                  media !== undefined,
              ),
          }
        : {}),
    }));
  }
}

import { Injectable } from '@nestjs/common';
import {
  resolvePageRequest,
  toPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/list';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import type { BlogRecord, UpdateBlogInput } from '../domain/blog';
import { BlogNotFoundError } from '../domain/blog-errors';
import { normalizeBlogSlug } from '../domain/blog-slug';
import { BlogRepository } from '../infrastructure/blog.repository';
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
    return toPaginatedResponse(page.items, pageRequest, page.total);
  }

  async getPublicBySlug(slug: string): Promise<BlogRecord> {
    const canonical = normalizeBlogSlug(slug);
    const found = await this.blogs.findPublishedBySlug(canonical);
    if (found === null) {
      throw new BlogNotFoundError();
    }
    return found;
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
    return toPaginatedResponse(page.items, pageRequest, page.total);
  }

  async getAdminById(id: string): Promise<BlogRecord> {
    const found = await this.blogs.findById(id);
    if (found === null) {
      throw new BlogNotFoundError();
    }
    return found;
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
    return created;
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
    return updated;
  }

  async publish(id: string, now = new Date()): Promise<BlogRecord> {
    const updated = await this.blogs.publish(id, now);
    if (updated === null) {
      throw new BlogNotFoundError();
    }

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

  async unpublish(id: string): Promise<BlogRecord> {
    const updated = await this.blogs.unpublish(id);
    if (updated === null) {
      throw new BlogNotFoundError();
    }

    this.logger.info(
      {
        module: 'blogs',
        operation: 'content.blog.unpublished',
        blogId: updated.id,
        publishedAt: updated.publishedAt?.toISOString() ?? null,
      },
      'Blog unpublished',
    );
    return updated;
  }
}

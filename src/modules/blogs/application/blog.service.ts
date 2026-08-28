import { Injectable } from '@nestjs/common';
import {
  resolvePageRequest,
  toPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/list';
import type { BlogRecord } from '../domain/blog';
import { BlogNotFoundError } from '../domain/blog-errors';
import { normalizeBlogSlug } from '../domain/blog-slug';
import { BlogRepository } from '../infrastructure/blog.repository';
import {
  resolvePublicBlogSort,
  type PublicBlogListQueryDto,
} from '../api/dto/public-blog-list-query.dto';

@Injectable()
export class BlogService {
  constructor(private readonly blogs: BlogRepository) {}

  /**
   * Public storefront list: published posts only.
   * Drafts never affect items, search matches, or pagination totals.
   */
  async listPublic(
    query: PublicBlogListQueryDto,
  ): Promise<PaginatedResponse<BlogRecord>> {
    const pageRequest = resolvePageRequest(query);
    const sort = resolvePublicBlogSort(query);
    const page = await this.blogs.list({
      page: pageRequest.page,
      pageSize: pageRequest.pageSize,
      search: query.search,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
      publishedOnly: true,
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
}

import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../../common/openapi/dto/common-response.dto';
import { BlogService } from '../application/blog.service';
import { PublicBlogListQueryDto } from './dto/public-blog-list-query.dto';
import {
  PublicBlogListResponseDto,
  PublicBlogResponseDto,
  toPublicBlogDetailDto,
  toPublicBlogListItemDto,
} from './dto/blog-response.dto';

@ApiTags('Blogs')
@Controller('blogs')
export class BlogsController {
  constructor(private readonly blogs: BlogService) {}

  @Get()
  @ApiOperation({
    operationId: 'Blogs_list',
    summary: 'List published blog posts',
    description: [
      'Paginated storefront list of published blog posts only.',
      'Supports `page`, `pageSize`, `search` (title only), and `sortBy`/`sortOrder` allowlist (`publishedAt`, `title`, `createdAt`; default `publishedAt`/`desc`) with a stable `id` tie-break.',
      'Draft and unpublished posts are never included in items or pagination totals.',
      '`isPublished` is not a public filter. Unknown query parameters are rejected.',
      'List items are id, slug, title, and publishedAt (UTC ISO 8601). Body is detail-only.',
      'No Redis caching. Responses follow the default public catalog cache policy (not no-store).',
    ].join(' '),
  })
  @ApiOkResponse({
    description: 'Paginated published blog posts.',
    type: PublicBlogListResponseDto,
  })
  async list(
    @Query() query: PublicBlogListQueryDto,
  ): Promise<InstanceType<typeof PublicBlogListResponseDto>> {
    const page = await this.blogs.listPublic(query);
    return {
      data: page.data.map(toPublicBlogListItemDto),
      meta: page.meta,
    };
  }

  @Get(':slug')
  @ApiOperation({
    operationId: 'Blogs_get',
    summary: 'Get a published blog post by slug',
    description: [
      'Returns a published blog post by its canonical slug.',
      'Missing slugs and unpublished/draft slugs both return BLOG_NOT_FOUND (no existence leak).',
      'Invalid slug format returns BLOG_INVALID_SLUG (400), which cannot enumerate drafts.',
      'Response fields are id, slug, title, body, and publishedAt (UTC ISO 8601).',
      'Body is stored markup; this API does not sanitize or render HTML.',
    ].join(' '),
  })
  @ApiParam({
    name: 'slug',
    description: 'Canonical lowercase kebab-case slug.',
    example: 'cage-free-eggs',
  })
  @ApiOkResponse({
    description: 'Published blog post.',
    type: PublicBlogResponseDto,
  })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async get(@Param('slug') slug: string): Promise<PublicBlogResponseDto> {
    const blog = await this.blogs.getPublicBySlug(slug);
    return { data: toPublicBlogDetailDto(blog) };
  }
}

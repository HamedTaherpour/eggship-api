import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Permission } from '../../../common/authz/permission';
import { PermissionGuard } from '../../../common/authz/permission.guard';
import { RequirePermissions } from '../../../common/authz/require-permissions.decorator';
import { ApiErrorResponseDto } from '../../../common/openapi/dto/common-response.dto';
import { AccessTokenGuard } from '../../auth/api/access-token.guard';
import { BlogService } from '../application/blog.service';
import { AdminBlogListQueryDto } from './dto/admin-blog-list-query.dto';
import {
  AdminBlogListResponseDto,
  AdminBlogResponseDto,
  toAdminBlogDetailDto,
  toAdminBlogListItemDto,
} from './dto/blog-response.dto';
import { CreateBlogBodyDto } from './dto/create-blog.dto';
import { UpdateBlogBodyDto } from './dto/update-blog.dto';

@ApiTags('AdminBlogs')
@Controller('admin/blogs')
@UseGuards(AccessTokenGuard, PermissionGuard)
@ApiCookieAuth('adminAccessCookie')
@ApiBearerAuth('bearer')
export class AdminBlogsController {
  constructor(private readonly blogs: BlogService) {}

  @Get()
  @RequirePermissions(Permission.CONTENT_READ)
  @ApiOperation({
    operationId: 'AdminBlogs_list',
    summary: 'List blog posts (Admin)',
    description: [
      'Paginated Admin list including drafts and published posts.',
      'Supports `page`, `pageSize`, optional `search` (title only), `sortBy`/`sortOrder` allowlist (`publishedAt`, `title`, `createdAt`; default `publishedAt`/`desc`) with a stable `id` tie-break, and optional `isPublished` filter.',
      'Unknown query parameters are rejected.',
      'Requires CONTENT_READ.',
      'Admin mutations are auditable candidates once AUD-01 exists.',
    ].join(' '),
  })
  @ApiOkResponse({
    description: 'Paginated blog posts.',
    type: AdminBlogListResponseDto,
  })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async list(
    @Query() query: AdminBlogListQueryDto,
  ): Promise<InstanceType<typeof AdminBlogListResponseDto>> {
    const page = await this.blogs.listAdmin(query);
    return {
      data: page.data.map(toAdminBlogListItemDto),
      meta: page.meta,
    };
  }

  @Get(':id')
  @RequirePermissions(Permission.CONTENT_READ)
  @ApiOperation({
    operationId: 'AdminBlogs_get',
    summary: 'Get a blog post by id (Admin)',
    description: [
      'Returns any blog post including drafts and unpublished rows.',
      'Requires CONTENT_READ.',
      'Returns BLOG_NOT_FOUND when the id does not exist.',
    ].join(' '),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Admin blog post.',
    type: AdminBlogResponseDto,
  })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminBlogResponseDto> {
    const blog = await this.blogs.getAdminById(id);
    return { data: toAdminBlogDetailDto(blog) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.CONTENT_MANAGE)
  @ApiOperation({
    operationId: 'AdminBlogs_create',
    summary: 'Create a blog draft (Admin)',
    description: [
      'Creates a draft blog post with canonical slug, title, and body normalization.',
      'Publication uses POST .../publish; direct published creation is not supported.',
      'Requires CONTENT_MANAGE.',
      'Returns BLOG_SLUG_CONFLICT when the slug is already in use.',
      'No Media attachment fields (MED-01). Admin mutations are auditable candidates once AUD-01 exists.',
    ].join(' '),
  })
  @ApiBody({ type: CreateBlogBodyDto })
  @ApiCreatedResponse({
    description: 'Created blog draft.',
    type: AdminBlogResponseDto,
  })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async create(@Body() body: CreateBlogBodyDto): Promise<AdminBlogResponseDto> {
    const created = await this.blogs.create(body);
    return { data: toAdminBlogDetailDto(created) };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.CONTENT_MANAGE)
  @ApiOperation({
    operationId: 'AdminBlogs_update',
    summary: 'Update a blog post (Admin)',
    description: [
      'Updates allowlisted fields only: slug, title, body.',
      'Unknown body properties are rejected. Mass assignment of id/timestamps/publication is impossible.',
      'Publication uses dedicated publish/unpublish routes.',
      'Requires CONTENT_MANAGE.',
      'Returns BLOG_NOT_FOUND when the id does not exist.',
      'Returns BLOG_SLUG_CONFLICT when the slug is already in use.',
    ].join(' '),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateBlogBodyDto })
  @ApiOkResponse({
    description: 'Updated blog post.',
    type: AdminBlogResponseDto,
  })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateBlogBodyDto,
  ): Promise<AdminBlogResponseDto> {
    const updated = await this.blogs.update(id, body);
    return { data: toAdminBlogDetailDto(updated) };
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.CONTENT_MANAGE)
  @ApiOperation({
    operationId: 'AdminBlogs_publish',
    summary: 'Publish a blog post (Admin)',
    description: [
      'Explicit publish command. Sets `isPublished=true` and establishes `publishedAt` from authoritative server time.',
      'Republish after unpublish records a new publication instant.',
      'Replay on an already-published post is idempotent and preserves `publishedAt`.',
      'No scheduling: future `publishedAt` is not used as a visibility gate.',
      'Requires CONTENT_MANAGE.',
      'Returns BLOG_NOT_FOUND when the id does not exist.',
    ].join(' '),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Published blog post.',
    type: AdminBlogResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async publish(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminBlogResponseDto> {
    const published = await this.blogs.publish(id);
    return { data: toAdminBlogDetailDto(published) };
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.CONTENT_MANAGE)
  @ApiOperation({
    operationId: 'AdminBlogs_unpublish',
    summary: 'Unpublish a blog post (Admin)',
    description: [
      'Explicit unpublish command. Sets `isPublished=false` while retaining the last `publishedAt` instant as publication history.',
      'Replay on an already-unpublished draft is idempotent.',
      'Requires CONTENT_MANAGE.',
      'Returns BLOG_NOT_FOUND when the id does not exist.',
    ].join(' '),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Unpublished blog post.',
    type: AdminBlogResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async unpublish(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminBlogResponseDto> {
    const unpublished = await this.blogs.unpublish(id);
    return { data: toAdminBlogDetailDto(unpublished) };
  }
}

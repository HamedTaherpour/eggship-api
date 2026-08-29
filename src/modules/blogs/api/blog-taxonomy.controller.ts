import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '../../../common/authz/permission';
import { PermissionGuard } from '../../../common/authz/permission.guard';
import { RequirePermissions } from '../../../common/authz/require-permissions.decorator';
import { AccessTokenGuard } from '../../auth/api/access-token.guard';
import { BlogTaxonomyService } from '../application/blog-taxonomy.service';
import {
  BlogAuthorNotFoundError,
  BlogCategoryNotFoundError,
  BlogTagNotFoundError,
} from '../domain/blog-errors';
import {
  BlogTaxonomyBodyDto,
  BlogTaxonomyPatchDto,
} from './dto/blog-taxonomy.dto';

@ApiTags('AdminBlogTaxonomy')
@Controller('admin')
@UseGuards(AccessTokenGuard, PermissionGuard)
@ApiCookieAuth('adminAccessCookie')
@ApiBearerAuth('bearer')
export class AdminBlogTaxonomyController {
  constructor(private readonly taxonomy: BlogTaxonomyService) {}
  @Get('blog-categories')
  @RequirePermissions(Permission.CONTENT_READ)
  async categories(): Promise<{ data: object[] }> {
    return { data: await this.taxonomy.list('category') };
  }
  @Get('blog-tags')
  @RequirePermissions(Permission.CONTENT_READ)
  async tags(): Promise<{ data: object[] }> {
    return { data: await this.taxonomy.list('tag') };
  }
  @Get('blog-authors')
  @RequirePermissions(Permission.CONTENT_READ)
  async authors(): Promise<{ data: object[] }> {
    return { data: await this.taxonomy.list('author') };
  }
  @Post('blog-categories')
  @RequirePermissions(Permission.CONTENT_MANAGE)
  async createCategory(
    @Body() body: BlogTaxonomyBodyDto,
  ): Promise<{ data: object }> {
    return { data: await this.taxonomy.create('category', body) };
  }
  @Post('blog-tags')
  @RequirePermissions(Permission.CONTENT_MANAGE)
  async createTag(
    @Body() body: BlogTaxonomyBodyDto,
  ): Promise<{ data: object }> {
    return { data: await this.taxonomy.create('tag', body) };
  }
  @Post('blog-authors')
  @RequirePermissions(Permission.CONTENT_MANAGE)
  async createAuthor(
    @Body() body: BlogTaxonomyBodyDto,
  ): Promise<{ data: object }> {
    return { data: await this.taxonomy.create('author', body) };
  }
  @Patch('blog-categories/:id')
  @RequirePermissions(Permission.CONTENT_MANAGE)
  async updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: BlogTaxonomyPatchDto,
  ): Promise<{ data: object }> {
    const value = await this.taxonomy.update('category', id, body);
    if (value === null) throw new BlogCategoryNotFoundError();
    return { data: value };
  }
  @Patch('blog-tags/:id')
  @RequirePermissions(Permission.CONTENT_MANAGE)
  async updateTag(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: BlogTaxonomyPatchDto,
  ): Promise<{ data: object }> {
    const value = await this.taxonomy.update('tag', id, body);
    if (value === null) throw new BlogTagNotFoundError();
    return { data: value };
  }
  @Patch('blog-authors/:id')
  @RequirePermissions(Permission.CONTENT_MANAGE)
  async updateAuthor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: BlogTaxonomyPatchDto,
  ): Promise<{ data: object }> {
    const value = await this.taxonomy.update('author', id, body);
    if (value === null) throw new BlogAuthorNotFoundError();
    return { data: value };
  }
  @Delete('blog-categories/:id')
  @RequirePermissions(Permission.CONTENT_MANAGE)
  async deleteCategory(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: null }> {
    if ((await this.taxonomy.get('category', id)) === null)
      throw new BlogCategoryNotFoundError();
    await this.taxonomy.delete('category', id);
    return { data: null };
  }
  @Delete('blog-tags/:id')
  @RequirePermissions(Permission.CONTENT_MANAGE)
  async deleteTag(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: null }> {
    if ((await this.taxonomy.get('tag', id)) === null)
      throw new BlogTagNotFoundError();
    await this.taxonomy.delete('tag', id);
    return { data: null };
  }
  @Delete('blog-authors/:id')
  @RequirePermissions(Permission.CONTENT_MANAGE)
  async deleteAuthor(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: null }> {
    if ((await this.taxonomy.get('author', id)) === null)
      throw new BlogAuthorNotFoundError();
    await this.taxonomy.delete('author', id);
    return { data: null };
  }
}

@ApiTags('BlogTaxonomy')
@Controller()
export class PublicBlogTaxonomyController {
  constructor(private readonly taxonomy: BlogTaxonomyService) {}
  @Get('blog-categories') async categories(): Promise<{ data: object[] }> {
    return { data: await this.taxonomy.list('category', true) };
  }
  @Get('blog-tags') async tags(): Promise<{ data: object[] }> {
    return { data: await this.taxonomy.list('tag') };
  }
  @Get('blog-authors') async authors(): Promise<{ data: object[] }> {
    return { data: await this.taxonomy.list('author', true) };
  }
}

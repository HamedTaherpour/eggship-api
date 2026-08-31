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
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
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
import { getAuthenticatedPrincipal } from '../../auth/api/authenticated-principal.util';
import type { Request } from 'express';
import { CategoryService } from '../application/category.service';
import { AdminCategoryListQueryDto } from './dto/admin-category-list-query.dto';
import {
  AdminCategoryListResponseDto,
  AdminCategoryResponseDto,
  toAdminCategoryDto,
} from './dto/category-response.dto';
import { CreateCategoryBodyDto } from './dto/create-category.dto';
import { UpdateCategoryBodyDto } from './dto/update-category.dto';

@ApiTags('AdminCategories')
@Controller('admin/categories')
@UseGuards(AccessTokenGuard, PermissionGuard)
@ApiCookieAuth('adminAccessCookie')
@ApiBearerAuth('bearer')
export class AdminCategoriesController {
  constructor(private readonly categories: CategoryService) {}

  @Get()
  @RequirePermissions(Permission.CATALOG_READ)
  @ApiOperation({
    operationId: 'AdminCategories_list',
    summary: 'List categories (Admin)',
    description: [
      'Paginated Admin list with optional `search` (name), `sortBy`/`sortOrder`, and `isActive` filter.',
      'Unknown query parameters are rejected.',
      'Requires CATALOG_READ.',
    ].join(' '),
  })
  @ApiOkResponse({
    description: 'Paginated categories.',
    type: AdminCategoryListResponseDto,
  })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async list(
    @Query() query: AdminCategoryListQueryDto,
  ): Promise<InstanceType<typeof AdminCategoryListResponseDto>> {
    const page = await this.categories.listAdmin(query);
    return {
      data: page.data.map(toAdminCategoryDto),
      meta: page.meta,
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.CATALOG_MANAGE)
  @ApiOperation({
    operationId: 'AdminCategories_create',
    summary: 'Create a category (Admin)',
    description: [
      'Creates a category with trimmed name and optional isActive (default true).',
      'No hard-delete endpoint: deactivate via PATCH.',
      'Requires CATALOG_MANAGE.',
      'Future Product FKs will revisit deletion restrictions (Restrict).',
      'Admin mutations are auditable candidates once AUD-01 exists.',
    ].join(' '),
  })
  @ApiBody({ type: CreateCategoryBodyDto })
  @ApiCreatedResponse({
    description: 'Created category.',
    type: AdminCategoryResponseDto,
  })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async create(
    @Body() body: CreateCategoryBodyDto,
    @Req() request: Request,
  ): Promise<AdminCategoryResponseDto> {
    const created = await this.categories.create(
      body,
      getAuthenticatedPrincipal(request),
    );
    return { data: toAdminCategoryDto(created) };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.CATALOG_MANAGE)
  @ApiOperation({
    operationId: 'AdminCategories_update',
    summary: 'Update a category (Admin)',
    description: [
      'Updates allowlisted fields only: name, isActive.',
      'Unknown body properties are rejected. Mass assignment of id/timestamps is impossible.',
      'Requires CATALOG_MANAGE.',
      'Returns CATEGORY_NOT_FOUND when the id does not exist.',
    ].join(' '),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateCategoryBodyDto })
  @ApiOkResponse({
    description: 'Updated category.',
    type: AdminCategoryResponseDto,
  })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCategoryBodyDto,
    @Req() request: Request,
  ): Promise<AdminCategoryResponseDto> {
    const updated = await this.categories.update(
      id,
      body,
      getAuthenticatedPrincipal(request),
    );
    return { data: toAdminCategoryDto(updated) };
  }
}

import {
  Body,
  Controller,
  Get,
  Header,
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
import type { Request } from 'express';
import { Permission } from '../../../common/authz/permission';
import { PermissionGuard } from '../../../common/authz/permission.guard';
import { RequirePermissions } from '../../../common/authz/require-permissions.decorator';
import { ApiErrorResponseDto } from '../../../common/openapi/dto/common-response.dto';
import { resolvePageRequest, toPaginatedResponse } from '../../../common/list';
import { AccessTokenGuard } from '../../auth/api/access-token.guard';
import { getAuthenticatedPrincipal } from '../../auth/api/authenticated-principal.util';
import { AdminManagementService } from '../application/admin-management.service';
import {
  AdminListQueryDto,
  resolveAdminSort,
} from './dto/admin-list-query.dto';
import {
  AdminManagementListResponseDto,
  AdminManagementResponseDto,
  ChangeAdminRoleBodyDto,
  CreateAdminBodyDto,
  toAdminManagementDto,
} from './dto/admin-management.dto';

@ApiTags('AdminManagement')
@Controller('admin/admins')
@UseGuards(AccessTokenGuard, PermissionGuard)
@ApiCookieAuth('adminAccessCookie')
@ApiBearerAuth('bearer')
export class AdminManagementController {
  constructor(private readonly service: AdminManagementService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.ADMIN_READ)
  @ApiOperation({
    operationId: 'AdminManagement_list',
    summary: 'List Admin accounts',
  })
  @ApiOkResponse({ type: AdminManagementListResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async list(
    @Query() query: AdminListQueryDto,
  ): Promise<InstanceType<typeof AdminManagementListResponseDto>> {
    const pageRequest = resolvePageRequest(query);
    const page = await this.service.list({
      page: pageRequest.page,
      pageSize: pageRequest.pageSize,
      search: query.search,
      role: query.role,
      isActive: query.isActive,
      ...resolveAdminSort(query),
    });
    const result = toPaginatedResponse(page.items, pageRequest, page.total);
    return { data: result.data.map(toAdminManagementDto), meta: result.meta };
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.ADMIN_READ)
  @ApiOperation({
    operationId: 'AdminManagement_get',
    summary: 'Get an Admin account',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminManagementResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminManagementResponseDto> {
    return { data: toAdminManagementDto(await this.service.get(id)) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.ADMIN_MANAGE)
  @ApiOperation({
    operationId: 'AdminManagement_create',
    summary: 'Create an Admin account',
  })
  @ApiBody({ type: CreateAdminBodyDto })
  @ApiCreatedResponse({ type: AdminManagementResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  async create(
    @Body() body: CreateAdminBodyDto,
    @Req() request: Request,
  ): Promise<AdminManagementResponseDto> {
    const actor = getAuthenticatedPrincipal(request)!;
    return {
      data: toAdminManagementDto(
        await this.service.create(body, actor.subjectId),
      ),
    };
  }

  @Patch(':id/role')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.ADMIN_MANAGE)
  @ApiOperation({
    operationId: 'AdminManagement_changeRole',
    summary: 'Change an Admin role',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: ChangeAdminRoleBodyDto })
  @ApiOkResponse({ type: AdminManagementResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async changeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChangeAdminRoleBodyDto,
    @Req() request: Request,
  ): Promise<AdminManagementResponseDto> {
    const actor = getAuthenticatedPrincipal(request)!;
    return {
      data: toAdminManagementDto(
        await this.service.changeRole(id, body.role, actor.subjectId),
      ),
    };
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.ADMIN_MANAGE)
  @ApiOperation({
    operationId: 'AdminManagement_disable',
    summary: 'Disable an Admin',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminManagementResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async disable(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<AdminManagementResponseDto> {
    const actor = getAuthenticatedPrincipal(request)!;
    return {
      data: toAdminManagementDto(
        await this.service.setActive(id, false, actor.subjectId),
      ),
    };
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.ADMIN_MANAGE)
  @ApiOperation({
    operationId: 'AdminManagement_enable',
    summary: 'Re-enable an Admin',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminManagementResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async enable(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<AdminManagementResponseDto> {
    const actor = getAuthenticatedPrincipal(request)!;
    return {
      data: toAdminManagementDto(
        await this.service.setActive(id, true, actor.subjectId),
      ),
    };
  }
}

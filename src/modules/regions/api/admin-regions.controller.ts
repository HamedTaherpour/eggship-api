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
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
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
import { RegionService } from '../application/region.service';
import { AdminRegionListQueryDto } from './dto/admin-region-list-query.dto';
import { CreateRegionBodyDto } from './dto/create-region.dto';
import {
  AdminRegionListResponseDto,
  AdminRegionResponseDto,
  toAdminRegionDto,
} from './dto/region-response.dto';
import { UpdateRegionBodyDto } from './dto/update-region.dto';

@ApiTags('AdminRegions')
@Controller('admin/regions')
@UseGuards(AccessTokenGuard, PermissionGuard)
@ApiCookieAuth('adminAccessCookie')
@ApiBearerAuth('bearer')
export class AdminRegionsController {
  constructor(private readonly regions: RegionService) {}

  @Get()
  @RequirePermissions(Permission.CATALOG_READ)
  @ApiOperation({
    operationId: 'AdminRegions_list',
    summary: 'List regions (Admin)',
    description: [
      'Paginated Admin list with optional `search` (name), `sortBy`/`sortOrder`, and `isActive` filter.',
      'Unknown query parameters are rejected.',
      'Requires CATALOG_READ.',
    ].join(' '),
  })
  @ApiOkResponse({
    description: 'Paginated regions.',
    type: AdminRegionListResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async list(
    @Query() query: AdminRegionListQueryDto,
  ): Promise<InstanceType<typeof AdminRegionListResponseDto>> {
    const page = await this.regions.listAdmin(query);
    return {
      data: page.data.map(toAdminRegionDto),
      meta: page.meta,
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.CATALOG_MANAGE)
  @ApiOperation({
    operationId: 'AdminRegions_create',
    summary: 'Create a region (Admin)',
    description: [
      'Creates a region with trimmed name and optional isActive (default true).',
      'No hard-delete endpoint: deactivate via PATCH.',
      'Requires CATALOG_MANAGE.',
      'Future profile/delivery FKs will revisit deletion restrictions (Restrict).',
      'Admin mutations are auditable candidates once AUD-01 exists.',
    ].join(' '),
  })
  @ApiBody({ type: CreateRegionBodyDto })
  @ApiCreatedResponse({
    description: 'Created region.',
    type: AdminRegionResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async create(
    @Body() body: CreateRegionBodyDto,
  ): Promise<AdminRegionResponseDto> {
    const created = await this.regions.create(body);
    return { data: toAdminRegionDto(created) };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.CATALOG_MANAGE)
  @ApiOperation({
    operationId: 'AdminRegions_update',
    summary: 'Update a region (Admin)',
    description: [
      'Updates allowlisted fields only: name, isActive.',
      'Unknown body properties are rejected. Mass assignment of id/timestamps is impossible.',
      'Requires CATALOG_MANAGE.',
      'Returns REGION_NOT_FOUND when the id does not exist.',
    ].join(' '),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateRegionBodyDto })
  @ApiOkResponse({
    description: 'Updated region.',
    type: AdminRegionResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRegionBodyDto,
  ): Promise<AdminRegionResponseDto> {
    const updated = await this.regions.update(id, body);
    return { data: toAdminRegionDto(updated) };
  }
}

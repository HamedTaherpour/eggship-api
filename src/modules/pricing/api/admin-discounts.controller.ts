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
import { DiscountService } from '../application/discount.service';
import { AdminDiscountListQueryDto } from './dto/admin-discount-list-query.dto';
import {
  CreateDiscountBodyDto,
  toCreateDiscountInput,
} from './dto/create-discount.dto';
import {
  AdminDiscountListResponseDto,
  AdminDiscountResponseDto,
  toAdminDiscountDto,
} from './dto/discount-response.dto';
import {
  toUpdateDiscountInput,
  UpdateDiscountBodyDto,
} from './dto/update-discount.dto';

@ApiTags('AdminDiscounts')
@Controller('admin/discounts')
@UseGuards(AccessTokenGuard, PermissionGuard)
@ApiCookieAuth('adminAccessCookie')
@ApiBearerAuth('bearer')
export class AdminDiscountsController {
  constructor(private readonly discounts: DiscountService) {}

  @Get()
  @RequirePermissions(Permission.DISCOUNT_READ)
  @ApiOperation({
    operationId: 'AdminDiscounts_list',
    summary: 'List discounts (Admin)',
    description: [
      'Paginated Admin list with optional `search` (name), `sortBy`/`sortOrder` (`name`, `createdAt`, `updatedAt`, `precedence`; default `createdAt`/`desc`), and filters `isActive`, `type`, `target`.',
      'Unknown query parameters are rejected.',
      'Requires DISCOUNT_READ.',
    ].join(' '),
  })
  @ApiOkResponse({
    description: 'Paginated discounts.',
    type: AdminDiscountListResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  async list(
    @Query() query: AdminDiscountListQueryDto,
  ): Promise<InstanceType<typeof AdminDiscountListResponseDto>> {
    const page = await this.discounts.listAdmin(query);
    return {
      data: page.data.map(toAdminDiscountDto),
      meta: page.meta,
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.DISCOUNT_MANAGE)
  @ApiOperation({
    operationId: 'AdminDiscounts_create',
    summary: 'Create a discount (Admin)',
    description: [
      'Creates a discount with server-side validation of type/value/target/window combinations.',
      'No hard-delete endpoint: deactivate via POST .../deactivate.',
      'Requires DISCOUNT_MANAGE.',
      'Admin mutations are auditable candidates once AUD-01 exists.',
    ].join(' '),
  })
  @ApiBody({ type: CreateDiscountBodyDto })
  @ApiCreatedResponse({
    description: 'Created discount.',
    type: AdminDiscountResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  async create(
    @Body() body: CreateDiscountBodyDto,
  ): Promise<AdminDiscountResponseDto> {
    const created = await this.discounts.create(toCreateDiscountInput(body));
    return { data: toAdminDiscountDto(created) };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.DISCOUNT_MANAGE)
  @ApiOperation({
    operationId: 'AdminDiscounts_update',
    summary: 'Update a discount (Admin)',
    description: [
      'Updates allowlisted fields only. Use activate/deactivate routes for lifecycle changes.',
      'Unknown body properties are rejected. Mass assignment of id/timestamps/actor is impossible.',
      'Requires DISCOUNT_MANAGE.',
      'Returns DISCOUNT_NOT_FOUND when the id does not exist.',
    ].join(' '),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateDiscountBodyDto })
  @ApiOkResponse({
    description: 'Updated discount.',
    type: AdminDiscountResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDiscountBodyDto,
  ): Promise<AdminDiscountResponseDto> {
    const updated = await this.discounts.update(
      id,
      toUpdateDiscountInput(body),
    );
    return { data: toAdminDiscountDto(updated) };
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.DISCOUNT_MANAGE)
  @ApiOperation({
    operationId: 'AdminDiscounts_activate',
    summary: 'Activate a discount (Admin)',
    description: [
      'Sets isActive to true. Idempotent when already active.',
      'Requires DISCOUNT_MANAGE.',
      'Returns DISCOUNT_NOT_FOUND when the id does not exist.',
    ].join(' '),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Activated discount.',
    type: AdminDiscountResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async activate(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminDiscountResponseDto> {
    const updated = await this.discounts.activate(id);
    return { data: toAdminDiscountDto(updated) };
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.DISCOUNT_MANAGE)
  @ApiOperation({
    operationId: 'AdminDiscounts_deactivate',
    summary: 'Deactivate a discount (Admin)',
    description: [
      'Sets isActive to false. Prefer deactivation over hard delete.',
      'Requires DISCOUNT_MANAGE.',
      'Returns DISCOUNT_NOT_FOUND when the id does not exist.',
    ].join(' '),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Deactivated discount.',
    type: AdminDiscountResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async deactivate(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminDiscountResponseDto> {
    const updated = await this.discounts.deactivate(id);
    return { data: toAdminDiscountDto(updated) };
  }
}

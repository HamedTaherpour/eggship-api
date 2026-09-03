import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
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
import { AdminCustomerService } from '../application/admin-customer.service';
import { AdminCustomerListQueryDto } from './dto/admin-customer-list-query.dto';
import {
  AdminCustomerListResponseDto,
  AdminCustomerResponseDto,
  toAdminCustomerDetailDto,
  toAdminCustomerListItemDto,
} from './dto/admin-customer-response.dto';

const ADMIN_CUSTOMER_CACHE_CONTROL = 'no-store';

@ApiTags('AdminCustomers')
@Controller('admin/customers')
@UseGuards(AccessTokenGuard, PermissionGuard)
@ApiCookieAuth('adminAccessCookie')
@ApiBearerAuth('bearer')
export class AdminCustomersController {
  constructor(private readonly customers: AdminCustomerService) {}

  @Get()
  @Header('Cache-Control', ADMIN_CUSTOMER_CACHE_CONTROL)
  @RequirePermissions(Permission.CUSTOMER_READ)
  @ApiOperation({
    operationId: 'AdminCustomers_list',
    summary: 'List store/customer accounts (Admin)',
    description: [
      'Paginated read-only list over the existing User identity (the storefront subject is the User record itself; no separate Store entity).',
      'Supports `page`, `pageSize`, optional `search` (phone substring only), `sortBy`/`sortOrder` allowlist (`createdAt`, `updatedAt`; default `createdAt`/`desc`) with a stable `id` tie-break, and explicit `isActive` / `hasReferral` filters.',
      'Unknown query parameters are rejected.',
      'Phone is purpose-limited to CUSTOMER_READ operators; responses are `Cache-Control: no-store`.',
      'Referral columns surface the existing immutable REF-02 attribution only; attribution cannot be created or changed here.',
      'Requires CUSTOMER_READ.',
    ].join(' '),
  })
  @ApiOkResponse({
    description: 'Paginated store/customer accounts.',
    type: AdminCustomerListResponseDto,
  })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async list(
    @Query() query: AdminCustomerListQueryDto,
  ): Promise<InstanceType<typeof AdminCustomerListResponseDto>> {
    const page = await this.customers.listAdmin(query);
    return {
      data: page.data.map(toAdminCustomerListItemDto),
      meta: page.meta,
    };
  }

  @Get(':id')
  @Header('Cache-Control', ADMIN_CUSTOMER_CACHE_CONTROL)
  @RequirePermissions(Permission.CUSTOMER_READ)
  @ApiOperation({
    operationId: 'AdminCustomers_get',
    summary: 'Get a store/customer account by id (Admin)',
    description: [
      'Returns the minimized User identity plus immutable Visitor referral evidence when present.',
      'Requires CUSTOMER_READ.',
      'Returns CUSTOMER_NOT_FOUND when the id does not exist.',
    ].join(' '),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Admin store/customer account.',
    type: AdminCustomerResponseDto,
  })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminCustomerResponseDto> {
    const customer = await this.customers.getAdminById(id);
    return { data: toAdminCustomerDetailDto(customer) };
  }
}

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
import { AdminVisitorService } from '../application/admin-visitor.service';
import {
  AdminReferralEvidenceListQueryDto,
  AdminVisitorListQueryDto,
} from './dto/admin-visitor-list-query.dto';
import {
  AdminReferralEvidenceListResponseDto,
  AdminVisitorListResponseDto,
  AdminVisitorResponseDto,
  toAdminReferralEvidenceDto,
  toAdminVisitorDto,
} from './dto/admin-visitor-response.dto';

@ApiTags('AdminVisitors')
@Controller('admin/visitors')
@UseGuards(AccessTokenGuard, PermissionGuard)
@ApiCookieAuth('adminAccessCookie')
@ApiBearerAuth('bearer')
export class AdminVisitorsController {
  constructor(private readonly visitors: AdminVisitorService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.VISITOR_READ)
  @ApiOperation({
    operationId: 'AdminVisitors_list',
    summary: 'List referral visitors (Admin)',
    description:
      'Read-only bounded visitor list. Search is limited to visitor name and referral code; filters are isActive and hasAttributions; sorting is allowlisted and uses id as a stable tie-break. Requires VISITOR_READ.',
  })
  @ApiOkResponse({ type: AdminVisitorListResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  list(
    @Query() query: AdminVisitorListQueryDto,
  ): Promise<InstanceType<typeof AdminVisitorListResponseDto>> {
    return this.visitors.list(query).then((page) => ({
      data: page.data.map(toAdminVisitorDto),
      meta: page.meta,
    }));
  }

  @Get(':id/referrals')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.VISITOR_READ)
  @ApiOperation({
    operationId: 'AdminVisitors_listReferrals',
    summary: 'List visitor referral attribution evidence (Admin)',
    description:
      'Read-only bounded immutable registration attributions joined to the existing User/customer identity. Search matches referred customer phone or historical referral code. Requires VISITOR_READ.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminReferralEvidenceListResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  referrals(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AdminReferralEvidenceListQueryDto,
  ): Promise<InstanceType<typeof AdminReferralEvidenceListResponseDto>> {
    return this.visitors.listReferrals(id, query).then((page) => ({
      data: page.data.map(toAdminReferralEvidenceDto),
      meta: page.meta,
    }));
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(Permission.VISITOR_READ)
  @ApiOperation({
    operationId: 'AdminVisitors_get',
    summary: 'Get a referral visitor (Admin)',
    description:
      'Returns minimized visitor identity and durable attribution count. Attribution is historical and cannot be edited or reassigned through this API. Requires VISITOR_READ.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminVisitorResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminVisitorResponseDto> {
    return this.visitors
      .get(id)
      .then((visitor) => ({ data: toAdminVisitorDto(visitor) }));
  }
}

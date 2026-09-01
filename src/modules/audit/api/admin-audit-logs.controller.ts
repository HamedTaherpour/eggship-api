import {
  Controller,
  Get,
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
import { AuditLogService } from '../application/audit-log.service';
import { AdminAuditLogListQueryDto } from './dto/admin-audit-log-list-query.dto';
import {
  AdminAuditLogListResponseDto,
  AdminAuditLogResponseDto,
  toAdminAuditLogDetailDto,
  toAdminAuditLogListItemDto,
} from './dto/audit-log-response.dto';

@ApiTags('AdminAuditLogs')
@Controller('admin/audit-logs')
@UseGuards(AccessTokenGuard, PermissionGuard)
@ApiCookieAuth('adminAccessCookie')
@ApiBearerAuth('bearer')
export class AdminAuditLogsController {
  constructor(private readonly audit: AuditLogService) {}

  @Get()
  @RequirePermissions(Permission.AUDIT_READ)
  @ApiOperation({
    operationId: 'AdminAuditLogs_list',
    summary: 'List audit log entries (Admin)',
    description:
      'Read-only, paginated audit review. Supports explicit indexed filters and occurredAt range; metadata search and export are not available. Requires AUDIT_READ.',
  })
  @ApiOkResponse({ type: AdminAuditLogListResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async list(
    @Query() query: AdminAuditLogListQueryDto,
  ): Promise<InstanceType<typeof AdminAuditLogListResponseDto>> {
    const page = await this.audit.listAdmin(query);
    return { data: page.data.map(toAdminAuditLogListItemDto), meta: page.meta };
  }

  @Get(':id')
  @RequirePermissions(Permission.AUDIT_READ)
  @ApiOperation({
    operationId: 'AdminAuditLogs_get',
    summary: 'Get an audit log entry (Admin)',
    description:
      'Returns the safe immutable audit event contract, including bounded action-specific metadata. Requires AUDIT_READ.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminAuditLogResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminAuditLogResponseDto> {
    return {
      data: toAdminAuditLogDetailDto(await this.audit.getAdminById(id)),
    };
  }
}

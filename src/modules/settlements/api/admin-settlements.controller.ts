import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
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
import type { Request, Response } from 'express';
import { Permission } from '../../../common/authz/permission';
import { PermissionGuard } from '../../../common/authz/permission.guard';
import { RequirePermissions } from '../../../common/authz/require-permissions.decorator';
import { ApiErrorResponseDto } from '../../../common/openapi/dto/common-response.dto';
import { AccessTokenGuard } from '../../auth/api/access-token.guard';
import { getAuthenticatedPrincipal } from '../../auth/api/authenticated-principal.util';
import { SettlementService } from '../application/settlement.service';
import { AdminSettlementListQueryDto } from './dto/admin-settlement-list-query.dto';
import {
  AttachSettlementReceiptBodyDto,
  ChangeSettlementDueDateBodyDto,
  CreateSettlementBodyDto,
} from './dto/settlement-request.dto';
import {
  AdminSettlementListResponseDto,
  AdminSettlementResponseDto,
  toAdminSettlementDto,
} from './dto/settlement-response.dto';
import { AdminSettlementReceiptAccessResponseDto } from './dto/settlement-response.dto';

@ApiTags('AdminSettlements')
@Controller('admin/settlements')
@UseGuards(AccessTokenGuard, PermissionGuard)
@ApiCookieAuth('adminAccessCookie')
@ApiBearerAuth('bearer')
export class AdminSettlementsController {
  constructor(private readonly settlements: SettlementService) {}

  @Get()
  @RequirePermissions(Permission.SETTLEMENT_READ)
  @ApiOperation({
    operationId: 'AdminSettlements_list',
    summary: 'List deferred settlements (Admin)',
    description:
      'Paginated list with status, derived overdue, inclusive dueFrom/dueTo, and exact orderId filters. Sort allowlist: dueAt, createdAt, settledAt; default dueAt asc with id tie-break. No free-text search. Requires SETTLEMENT_READ.',
  })
  @ApiOkResponse({ type: AdminSettlementListResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async list(
    @Query() query: AdminSettlementListQueryDto,
  ): Promise<InstanceType<typeof AdminSettlementListResponseDto>> {
    const page = await this.settlements.listAdmin(query);
    return { data: page.data.map(toAdminSettlementDto), meta: page.meta };
  }

  @Get(':id')
  @RequirePermissions(Permission.SETTLEMENT_READ)
  @ApiOperation({
    operationId: 'AdminSettlements_get',
    summary: 'Get a deferred settlement (Admin)',
    description:
      'Returns the settlement, current Order status, and immutable Order total. Requires SETTLEMENT_READ.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminSettlementResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminSettlementResponseDto> {
    return {
      data: toAdminSettlementDto(await this.settlements.getAdminById(id)),
    };
  }

  @Get(':id/receipt-access')
  @RequirePermissions(Permission.SETTLEMENT_READ)
  @ApiOperation({
    operationId: 'AdminSettlements_getReceiptAccess',
    summary: 'Create a short-lived settlement receipt URL (Admin)',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminSettlementReceiptAccessResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async receiptAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AdminSettlementReceiptAccessResponseDto> {
    const value = await this.settlements.getReceiptAccess(id);
    response.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    return {
      data: { url: value.url, expiresAt: value.expiresAt.toISOString() },
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.SETTLEMENT_MANAGE)
  @ApiOperation({
    operationId: 'AdminSettlements_create',
    summary: 'Create a deferred settlement (Admin)',
    description:
      'Creates OPEN tracking for a currently DELIVERED Order. dueAt is a required absolute instant and may be in the past. Stable failures: ORDER_NOT_FOUND, SETTLEMENT_ORDER_NOT_DELIVERED, SETTLEMENT_ALREADY_EXISTS, SETTLEMENT_INVALID_DUE_DATE. Requires SETTLEMENT_MANAGE.',
  })
  @ApiBody({ type: CreateSettlementBodyDto })
  @ApiCreatedResponse({ type: AdminSettlementResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async create(
    @Body() body: CreateSettlementBodyDto,
    @Req() request: Request,
  ): Promise<AdminSettlementResponseDto> {
    const record = await this.settlements.create(
      body.orderId,
      body.dueAt,
      actorId(request),
    );
    return { data: toAdminSettlementDto(record) };
  }

  @Post(':id/change-due-date')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.SETTLEMENT_MANAGE)
  @ApiOperation({
    operationId: 'AdminSettlements_changeDueDate',
    summary: 'Change an open settlement due date (Admin)',
    description:
      'Explicit command; rejected after SETTLED. Past absolute instants remain allowed. Stable failures: SETTLEMENT_NOT_FOUND, SETTLEMENT_INVALID_DUE_DATE, SETTLEMENT_INVALID_TRANSITION. Requires SETTLEMENT_MANAGE.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: ChangeSettlementDueDateBodyDto })
  @ApiOkResponse({ type: AdminSettlementResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async changeDueDate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChangeSettlementDueDateBodyDto,
    @Req() request: Request,
  ): Promise<AdminSettlementResponseDto> {
    const record = await this.settlements.changeDueAt(
      id,
      body.dueAt,
      actorId(request),
    );
    return { data: toAdminSettlementDto(record) };
  }

  @Post(':id/receipt')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.SETTLEMENT_MANAGE)
  @ApiOperation({
    operationId: 'AdminSettlements_attachReceipt',
    summary: 'Attach or replace a settlement receipt (Admin)',
    description:
      'References an existing JPEG/PNG/WebP Media id; no upload occurs here. Same-Media replay is idempotent. Replacement is allowed only while OPEN and never auto-settles. Stable failures: SETTLEMENT_NOT_FOUND, MEDIA_NOT_FOUND, MEDIA_UNSUPPORTED_TYPE, SETTLEMENT_INVALID_TRANSITION. Requires SETTLEMENT_MANAGE.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: AttachSettlementReceiptBodyDto })
  @ApiOkResponse({ type: AdminSettlementResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async attachReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AttachSettlementReceiptBodyDto,
    @Req() request: Request,
  ): Promise<AdminSettlementResponseDto> {
    const record = await this.settlements.attachReceipt(
      id,
      body.mediaId,
      actorId(request),
    );
    return { data: toAdminSettlementDto(record) };
  }

  @Post(':id/settle')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.SETTLEMENT_MANAGE)
  @ApiOperation({
    operationId: 'AdminSettlements_settle',
    summary: 'Mark a settlement settled (Admin)',
    description:
      'Requires an attached receipt. The first OPEN to SETTLED transition stamps server time and actor atomically; replay is idempotent and rewrites neither. Stable failures: SETTLEMENT_NOT_FOUND, SETTLEMENT_RECEIPT_REQUIRED, SETTLEMENT_INVALID_TRANSITION. No reopen command exists. Requires SETTLEMENT_MANAGE.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminSettlementResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async settle(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<AdminSettlementResponseDto> {
    const record = await this.settlements.markSettled(id, actorId(request));
    return { data: toAdminSettlementDto(record) };
  }
}

function actorId(request: Request): string {
  return getAuthenticatedPrincipal(request)!.subjectId;
}

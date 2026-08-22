import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
  ApiForbiddenResponse,
  ApiHeader,
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
import { AccessTokenGuard } from '../../auth/api/access-token.guard';
import { getAuthenticatedPrincipal } from '../../auth/api/authenticated-principal.util';
import { AdminInventoryOperationsService } from '../application/admin-inventory-operations.service';
import { AdminInventoryQueryService } from '../application/admin-inventory-query.service';
import { AdjustStockBodyDto } from './dto/adjust-stock.dto';
import { AdminInventoryLedgerListQueryDto } from './dto/admin-inventory-ledger-query.dto';
import {
  AdminInventoryLedgerListResponseDto,
  toAdminInventoryLedgerItemDto,
} from './dto/admin-inventory-ledger-response.dto';
import { AdminInventoryListQueryDto } from './dto/admin-inventory-list-query.dto';
import {
  AdminInventoryListResponseDto,
  toAdminInventoryListItemDto,
} from './dto/admin-inventory-list-response.dto';
import {
  AdminInventoryReconciliationResponseDto,
  toAdminInventoryReconciliationDto,
} from './dto/admin-inventory-reconciliation-response.dto';
import { AdminInventoryReservationListQueryDto } from './dto/admin-inventory-reservation-query.dto';
import {
  AdminInventoryReservationListResponseDto,
  toAdminInventoryReservationItemDto,
} from './dto/admin-inventory-reservation-response.dto';
import {
  InventoryBalanceResponseDto,
  toInventoryBalanceDto,
} from './dto/inventory-balance-response.dto';
import { ReceiveStockBodyDto } from './dto/receive-stock.dto';
import { IdempotencyKey } from './idempotency-key.decorator';

const INVENTORY_DIAGNOSTIC_CACHE_CONTROL = 'no-store';

@ApiTags('AdminInventory')
@Controller('admin/inventory')
@UseGuards(AccessTokenGuard, PermissionGuard)
@ApiCookieAuth('adminAccessCookie')
@ApiBearerAuth('bearer')
export class AdminInventoryController {
  constructor(
    private readonly inventoryOps: AdminInventoryOperationsService,
    private readonly inventoryQueries: AdminInventoryQueryService,
  ) {}

  @Get()
  @RequirePermissions(Permission.INVENTORY_READ)
  @ApiOperation({
    operationId: 'AdminInventory_list',
    summary: 'List inventory balances (Admin)',
    description: [
      'Paginated inventory rows joined with Product name and active flag.',
      'Search applies to Product name only. `available` is derived (`onHand - reserved`).',
      'Does not run reconciliation per row. Requires INVENTORY_READ.',
    ].join(' '),
  })
  @ApiOkResponse({
    description: 'Paginated inventory list.',
    type: AdminInventoryListResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  async list(
    @Query() query: AdminInventoryListQueryDto,
  ): Promise<InstanceType<typeof AdminInventoryListResponseDto>> {
    const page = await this.inventoryQueries.listAdmin(query);
    return {
      data: page.data.map(toAdminInventoryListItemDto),
      meta: page.meta,
    };
  }

  @Get(':productId/reconciliation')
  @RequirePermissions(Permission.INVENTORY_READ)
  @Header('Cache-Control', INVENTORY_DIAGNOSTIC_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'AdminInventory_getReconciliation',
    summary: 'Reconcile inventory diagnostics for one product (Admin)',
    description: [
      'Read-only comparison of aggregate balances, ACTIVE reservations, and ledger history.',
      'INCONSISTENT results return HTTP 200 with issue codes — the diagnostic succeeded.',
      'Does not repair or mutate inventory. Requires INVENTORY_READ.',
    ].join(' '),
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOkResponse({
    description: 'Reconciliation diagnostic result.',
    type: AdminInventoryReconciliationResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async getReconciliation(
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<AdminInventoryReconciliationResponseDto> {
    const result = await this.inventoryQueries.reconcileProduct(productId);
    return { data: toAdminInventoryReconciliationDto(result) };
  }

  @Get(':productId/ledger')
  @RequirePermissions(Permission.INVENTORY_READ)
  @Header('Cache-Control', INVENTORY_DIAGNOSTIC_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'AdminInventory_listLedger',
    summary: 'List inventory ledger history (Admin)',
    description: [
      'Paginated append-only ledger history for one product (newest first).',
      'Read-only diagnostic; no ledger mutation. Requires INVENTORY_READ.',
    ].join(' '),
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOkResponse({
    description: 'Paginated ledger history.',
    type: AdminInventoryLedgerListResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async listLedger(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: AdminInventoryLedgerListQueryDto,
  ): Promise<InstanceType<typeof AdminInventoryLedgerListResponseDto>> {
    const page = await this.inventoryQueries.listLedger(productId, query);
    return {
      data: page.data.map(toAdminInventoryLedgerItemDto),
      meta: page.meta,
    };
  }

  @Get(':productId/reservations')
  @RequirePermissions(Permission.INVENTORY_READ)
  @Header('Cache-Control', INVENTORY_DIAGNOSTIC_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'AdminInventory_listReservations',
    summary: 'List inventory reservations (Admin)',
    description: [
      'Paginated reservation diagnostics for one product (orderId + quantity + status only).',
      'Does not expose Order customer or address details. Requires INVENTORY_READ.',
    ].join(' '),
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOkResponse({
    description: 'Paginated reservation rows.',
    type: AdminInventoryReservationListResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async listReservations(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: AdminInventoryReservationListQueryDto,
  ): Promise<InstanceType<typeof AdminInventoryReservationListResponseDto>> {
    const page = await this.inventoryQueries.listReservations(productId, query);
    return {
      data: page.data.map(toAdminInventoryReservationItemDto),
      meta: page.meta,
    };
  }

  @Get(':productId')
  @RequirePermissions(Permission.INVENTORY_READ)
  @ApiOperation({
    operationId: 'AdminInventory_getBalance',
    summary: 'Get current inventory balance (Admin)',
    description: [
      'Returns derived `onHand`, `reserved`, and `available` for one product.',
      'Requires INVENTORY_READ. Missing inventory returns INVENTORY_NOT_FOUND.',
      'Inactive products remain readable/correctable; catalog visibility is separate.',
    ].join(' '),
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOkResponse({
    description: 'Current inventory balance.',
    type: InventoryBalanceResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async getBalance(
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<InventoryBalanceResponseDto> {
    const balance = await this.inventoryOps.getBalance(productId);
    return { data: toInventoryBalanceDto(balance) };
  }

  @Post(':productId/receive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.INVENTORY_ADJUST)
  @ApiOperation({
    operationId: 'AdminInventory_receiveStock',
    summary: 'Receive sellable stock (Admin)',
    description: [
      'Atomically increases on-hand by a positive integer quantity and appends a RECEIVE ledger row.',
      'Requires INVENTORY_ADJUST and a UUID `Idempotency-Key` header.',
      'Repeating the same key and payload replays the prior result without double mutation.',
      'A conflicting payload for the same key returns IDEMPOTENCY_CONFLICT.',
      'There is no direct on-hand setter; reserved is unchanged.',
    ].join(' '),
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiHeader({
    name: 'Idempotency-Key',
    description:
      'Caller-provided UUID idempotency key for this receive command.',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({ type: ReceiveStockBodyDto })
  @ApiOkResponse({
    description:
      'Updated inventory balance after receive (or idempotent replay).',
    type: InventoryBalanceResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  async receiveStock(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: ReceiveStockBodyDto,
    @IdempotencyKey() idempotencyKey: string,
    @Req() request: Request,
  ): Promise<InventoryBalanceResponseDto> {
    const principal = getAuthenticatedPrincipal(request);
    const balance = await this.inventoryOps.receiveStock({
      productId,
      quantity: body.quantity,
      idempotencyKey,
      principal: principal!,
    });
    return { data: toInventoryBalanceDto(balance) };
  }

  @Post(':productId/adjust')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.INVENTORY_ADJUST)
  @ApiOperation({
    operationId: 'AdminInventory_adjustStock',
    summary: 'Adjust on-hand stock by signed delta (Admin)',
    description: [
      'Atomically applies a signed on-hand delta with a required reason and ADJUST ledger row.',
      'Uses delta semantics only — never an absolute on-hand target.',
      'Rejects adjustments that would violate non-negativity or `reserved <= onHand`.',
      'Requires INVENTORY_ADJUST and a UUID `Idempotency-Key` header with the same replay/conflict rules as receive.',
    ].join(' '),
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiHeader({
    name: 'Idempotency-Key',
    description:
      'Caller-provided UUID idempotency key for this adjust command.',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({ type: AdjustStockBodyDto })
  @ApiOkResponse({
    description:
      'Updated inventory balance after adjustment (or idempotent replay).',
    type: InventoryBalanceResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  async adjustStock(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: AdjustStockBodyDto,
    @IdempotencyKey() idempotencyKey: string,
    @Req() request: Request,
  ): Promise<InventoryBalanceResponseDto> {
    const principal = getAuthenticatedPrincipal(request);
    const balance = await this.inventoryOps.adjustStock({
      productId,
      delta: body.delta,
      reason: body.reason,
      idempotencyKey,
      principal: principal!,
    });
    return { data: toInventoryBalanceDto(balance) };
  }
}

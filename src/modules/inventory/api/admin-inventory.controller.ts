import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
import { AdjustStockBodyDto } from './dto/adjust-stock.dto';
import {
  InventoryBalanceResponseDto,
  toInventoryBalanceDto,
} from './dto/inventory-balance-response.dto';
import { ReceiveStockBodyDto } from './dto/receive-stock.dto';
import { IdempotencyKey } from './idempotency-key.decorator';

@ApiTags('AdminInventory')
@Controller('admin/inventory')
@UseGuards(AccessTokenGuard, PermissionGuard)
@ApiCookieAuth('adminAccessCookie')
@ApiBearerAuth('bearer')
export class AdminInventoryController {
  constructor(private readonly inventoryOps: AdminInventoryOperationsService) {}

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

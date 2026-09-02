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
import { AuthError } from '../../auth/domain/auth-error';
import { AuthErrorCode } from '../../auth/domain/auth-error-codes';
import { AuthSubjectType } from '../../auth/domain/subject-type';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import { OrderReadService } from '../application/order-read.service';
import { OrderTransitionService } from '../application/order-transition.service';
import { OrderReturnService } from '../application/order-return.service';
import { OrderActorType } from '../domain/order-actor';
import { AdminOrderListQueryDto } from './dto/admin-order-list-query.dto';
import {
  AdminOrderDetailResponseDto,
  AdminOrderListResponseDto,
  toAdminOrderDetailDto,
  toAdminOrderListItemDto,
} from './dto/admin-order-response.dto';
import {
  AdminCancelOrderBodyDto,
  ConfirmOrderBodyDto,
} from './dto/admin-order-transition.dto';
import { IdempotencyKey } from './idempotency-key.decorator';
import {
  RecordOrderReturnBodyDto,
  RecordOrderReturnResponseDto,
  toOrderReturnResponseDto,
} from './dto/record-order-return.dto';

const ADMIN_ORDER_CACHE_CONTROL = 'no-store';

@ApiTags('AdminOrders')
@Controller('admin/orders')
@UseGuards(AccessTokenGuard, PermissionGuard)
@ApiCookieAuth('adminAccessCookie')
@ApiBearerAuth('bearer')
export class AdminOrdersController {
  constructor(
    private readonly reads: OrderReadService,
    private readonly transitions: OrderTransitionService,
    private readonly returns: OrderReturnService,
  ) {}

  @Get()
  @Header('Cache-Control', ADMIN_ORDER_CACHE_CONTROL)
  @RequirePermissions(Permission.ORDER_READ)
  @ApiOperation({
    operationId: 'AdminOrders_list',
    summary: 'List orders (Admin)',
    description:
      'Allowlisted pagination, filters (`status`, `regionId`, `createdFrom`, `createdTo`) and sorts (`createdAt`, `total`, `status`, `deliveryAt`). Search is not supported. Requires ORDER_READ; response is no-store.',
  })
  @ApiOkResponse({ type: AdminOrderListResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async list(
    @Query() query: AdminOrderListQueryDto,
  ): Promise<InstanceType<typeof AdminOrderListResponseDto>> {
    const page = await this.reads.listAdmin(query);
    return { data: page.data.map(toAdminOrderListItemDto), meta: page.meta };
  }

  @Get(':id')
  @Header('Cache-Control', ADMIN_ORDER_CACHE_CONTROL)
  @RequirePermissions(Permission.ORDER_READ)
  @ApiOperation({
    operationId: 'AdminOrders_get',
    summary: 'Get an order (Admin)',
    description:
      'Returns persisted historical snapshots and operational lifecycle/cancellation fields. Requires ORDER_READ; response is no-store.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminOrderDetailResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminOrderDetailResponseDto> {
    return { data: toAdminOrderDetailDto(await this.reads.getAdmin(id)) };
  }

  @Post(':id/confirm')
  @Header('Cache-Control', ADMIN_ORDER_CACHE_CONTROL)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.ORDER_TRANSITION)
  @ApiBody({ type: ConfirmOrderBodyDto })
  @ApiOperation({
    operationId: 'AdminOrders_confirm',
    summary: 'Confirm an order (Admin)',
    description:
      'PENDING_REVIEW → CONFIRMED. Optional deliveryAt is an ISO instant; replay is idempotent and preserves timestamps and deliveryAt.',
  })
  @ApiOkResponse({ type: AdminOrderDetailResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  async confirm(
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ConfirmOrderBodyDto,
  ): Promise<AdminOrderDetailResponseDto> {
    const principal = requireAdminPrincipal(request);
    const result = await this.transitions.confirmOrder({
      orderId: id,
      deliveryAt: body.deliveryAt,
      actor: { type: OrderActorType.ADMIN, id: principal.subjectId },
    });
    return { data: toAdminOrderDetailDto(result.order) };
  }

  @Post(':id/cancel')
  @Header('Cache-Control', ADMIN_ORDER_CACHE_CONTROL)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.ORDER_TRANSITION)
  @ApiBody({ type: AdminCancelOrderBodyDto })
  @ApiOperation({
    operationId: 'AdminOrders_cancel',
    summary: 'Cancel an order (Admin)',
    description:
      'PENDING_REVIEW or CONFIRMED → CANCELLED. Requires a trimmed 1–500 character reason. Replay is idempotent and atomically releases discount usage and Inventory.',
  })
  @ApiOkResponse({ type: AdminOrderDetailResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  async cancel(
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminCancelOrderBodyDto,
  ): Promise<AdminOrderDetailResponseDto> {
    const principal = requireAdminPrincipal(request);
    const result = await this.transitions.cancelOrderByAdmin({
      orderId: id,
      cancelReason: body.cancelReason ?? '',
      actor: { type: OrderActorType.ADMIN, id: principal.subjectId },
    });
    return { data: toAdminOrderDetailDto(result.order) };
  }

  @Post(':id/ship')
  @Header('Cache-Control', ADMIN_ORDER_CACHE_CONTROL)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.ORDER_TRANSITION)
  @ApiOperation({
    operationId: 'AdminOrders_ship',
    summary: 'Ship an order (Admin)',
    description:
      'CONFIRMED → SHIPPED with atomic Inventory shipment; replay does not repeat stock or ledger mutations.',
  })
  @ApiOkResponse({ type: AdminOrderDetailResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  async ship(
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminOrderDetailResponseDto> {
    const principal = requireAdminPrincipal(request);
    const result = await this.transitions.shipOrder({
      orderId: id,
      actor: { type: OrderActorType.ADMIN, id: principal.subjectId },
    });
    return { data: toAdminOrderDetailDto(result.order) };
  }

  @Post(':id/deliver')
  @Header('Cache-Control', ADMIN_ORDER_CACHE_CONTROL)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.ORDER_TRANSITION)
  @ApiOperation({
    operationId: 'AdminOrders_deliver',
    summary: 'Deliver an order (Admin)',
    description:
      'SHIPPED → DELIVERED without Inventory side effects; replay preserves deliveredAt.',
  })
  @ApiOkResponse({ type: AdminOrderDetailResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  async deliver(
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminOrderDetailResponseDto> {
    const principal = requireAdminPrincipal(request);
    const result = await this.transitions.deliverOrder({
      orderId: id,
      actor: { type: OrderActorType.ADMIN, id: principal.subjectId },
    });
    return { data: toAdminOrderDetailDto(result.order) };
  }

  @Post(':id/complete-return')
  @Header('Cache-Control', ADMIN_ORDER_CACHE_CONTROL)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.ORDER_TRANSITION)
  @ApiOperation({
    operationId: 'AdminOrders_completeReturn',
    summary: 'Complete an order return process (Admin)',
    description:
      'Explicitly completes return processing with DELIVERED → RETURNED. This does not create return records, restock Inventory, or change financial state; replay preserves returnedAt.',
  })
  @ApiOkResponse({ type: AdminOrderDetailResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  async completeReturn(
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminOrderDetailResponseDto> {
    const principal = requireAdminPrincipal(request);
    const result = await this.transitions.completeReturnProcess({
      orderId: id,
      actor: { type: OrderActorType.ADMIN, id: principal.subjectId },
    });
    return { data: toAdminOrderDetailDto(result.order) };
  }

  @Post(':id/returns')
  @Header('Cache-Control', ADMIN_ORDER_CACHE_CONTROL)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.ORDER_TRANSITION)
  @ApiBody({ type: RecordOrderReturnBodyDto })
  @ApiOperation({
    operationId: 'AdminOrders_recordReturn',
    summary: 'Record an inspected return (Admin)',
    description:
      'Records sellable and damaged returned quantities for a DELIVERED order. An Idempotency-Key is required; only sellable quantity is restocked. This does not complete DELIVERED → RETURNED.',
  })
  @ApiOkResponse({ type: RecordOrderReturnResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  async recordReturn(
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @IdempotencyKey() idempotencyKey: string,
    @Body() body: RecordOrderReturnBodyDto,
  ): Promise<RecordOrderReturnResponseDto> {
    const principal = requireAdminPrincipal(request);
    const result = await this.returns.recordReturn({
      orderId: id,
      idempotencyKey,
      reason: body.reason,
      lines: body.lines,
      actor: { type: OrderActorType.ADMIN, id: principal.subjectId },
    });
    return { data: toOrderReturnResponseDto(result.orderReturn) };
  }
}

function requireAdminPrincipal(request: Request): AuthenticatedPrincipal {
  const principal = getAuthenticatedPrincipal(request);
  if (principal === undefined)
    throw new AuthError(
      AuthErrorCode.UNAUTHENTICATED,
      'Authentication required.',
    );
  if (principal.subjectType !== AuthSubjectType.ADMIN)
    throw new AuthError(AuthErrorCode.FORBIDDEN, 'Insufficient permissions.');
  return principal;
}

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
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { requireCustomerOwnerId } from '../../../common/authz/resource-ownership';
import { ApiErrorResponseDto } from '../../../common/openapi/dto/common-response.dto';
import { AccessTokenGuard } from '../../auth/api/access-token.guard';
import { getAuthenticatedPrincipal } from '../../auth/api/authenticated-principal.util';
import { OrderCreationService } from '../application/order-creation.service';
import { OrderReadService } from '../application/order-read.service';
import { OrderTransitionService } from '../application/order-transition.service';
import { OrderActorType } from '../domain/order-actor';
import { CreateOrderBodyDto } from './dto/create-order.dto';
import { CancelOrderBodyDto } from './dto/cancel-order.dto';
import { CustomerOrderListQueryDto } from './dto/customer-order-list-query.dto';
import {
  CreateOrderResponseDto,
  CustomerOrderDetailResponseDto,
  CustomerOrderListResponseDto,
  toCustomerOrderDetailDto,
  toCustomerOrderDto,
  toCustomerOrderListItemDto,
} from './dto/customer-order-response.dto';
import { IdempotencyKey } from './idempotency-key.decorator';

const ORDER_CUSTOMER_CACHE_CONTROL = 'no-store';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orderCreation: OrderCreationService,
    private readonly orderRead: OrderReadService,
    private readonly orderTransitions: OrderTransitionService,
  ) {}

  @Get()
  @UseGuards(AccessTokenGuard)
  @Header('Cache-Control', ORDER_CUSTOMER_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'Orders_list',
    summary: 'List own customer orders',
    description: [
      'Authenticated USER subjects only. Derives owner scope exclusively from the authenticated principal.',
      'An authenticated Admin (or other non-customer subject) is rejected with AUTH_FORBIDDEN (403).',
      'Supports `page`, `pageSize`, optional `status`, inclusive `createdFrom`/`createdTo` (ISO 8601), and `sortBy`/`sortOrder` allowlist (`createdAt`, `total`, `status`; default `createdAt`/`desc` with stable `id` tie-break).',
      'No free-text search. Unknown query parameters are rejected.',
      'List items expose summary snapshot fields only (no line items).',
      'Response uses Cache-Control: no-store.',
    ].join(' '),
  })
  @ApiCookieAuth('accessCookie')
  @ApiBearerAuth('bearer')
  @ApiOkResponse({
    description: 'Paginated owner-scoped order summaries.',
    type: CustomerOrderListResponseDto,
    headers: {
      'Cache-Control': {
        description: 'Always no-store for authenticated customer data.',
        schema: { type: 'string', example: 'no-store' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid pagination, sort, filter, or date query.',
    type: ApiErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token (`AUTH_UNAUTHENTICATED`).',
    type: ApiErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Wrong subject type (`AUTH_FORBIDDEN`).',
    type: ApiErrorResponseDto,
  })
  async list(
    @Req() request: Request,
    @Query() query: CustomerOrderListQueryDto,
  ): Promise<InstanceType<typeof CustomerOrderListResponseDto>> {
    const ownerId = requireCustomerOwnerId(getAuthenticatedPrincipal(request));
    const page = await this.orderRead.listOwned(ownerId, query);
    return {
      data: page.data.map(toCustomerOrderListItemDto),
      meta: page.meta,
    };
  }

  @Get(':id')
  @UseGuards(AccessTokenGuard)
  @Header('Cache-Control', ORDER_CUSTOMER_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'Orders_get',
    summary: 'Get own customer order by id',
    description: [
      'Authenticated USER subjects only. Owner scope is enforced in the repository query (`id` + principal `userId`).',
      "Missing orders and another customer's order both return ORDER_NOT_FOUND (404) with the same response shape.",
      'Returns persisted historical line snapshots and lifecycle timestamps; does not join current Product/Discount state.',
      'Omits internal/admin fields (idempotency, commercePolicyRevision, cancel metadata, userId).',
      'Response uses Cache-Control: no-store.',
    ].join(' '),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCookieAuth('accessCookie')
  @ApiBearerAuth('bearer')
  @ApiOkResponse({
    description: 'Customer-safe order detail with line snapshots.',
    type: CustomerOrderDetailResponseDto,
    headers: {
      'Cache-Control': {
        description: 'Always no-store for authenticated customer data.',
        schema: { type: 'string', example: 'no-store' },
      },
    },
  })
  @ApiNotFoundResponse({
    description:
      'Order not found or not owned by the caller (`ORDER_NOT_FOUND`).',
    type: ApiErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token (`AUTH_UNAUTHENTICATED`).',
    type: ApiErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Wrong subject type (`AUTH_FORBIDDEN`).',
    type: ApiErrorResponseDto,
  })
  async get(
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerOrderDetailResponseDto> {
    const ownerId = requireCustomerOwnerId(getAuthenticatedPrincipal(request));
    const order = await this.orderRead.getOwned(ownerId, id);
    return { data: toCustomerOrderDetailDto(order) };
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard)
  @Header('Cache-Control', ORDER_CUSTOMER_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'Orders_cancel',
    summary: 'Cancel an own pending customer order',
    description: [
      'Authenticated USER subjects only. The owner is derived from the authenticated principal.',
      'Only PENDING_REVIEW orders may be cancelled; an already CANCELLED order replays successfully.',
      'Customer cancellation always stores a null cancellation reason and atomically releases lifetime discount usage and Inventory reservations.',
      "Missing orders and another customer's order both return ORDER_NOT_FOUND. Customer-facing responses do not expose Inventory or discount internals.",
      'Response uses Cache-Control: no-store. Cookie-authenticated browser clients remain subject to the shared AUTH-09 CSRF production blocker.',
    ].join(' '),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCookieAuth('accessCookie')
  @ApiBearerAuth('bearer')
  @ApiBody({ type: CancelOrderBodyDto })
  @ApiOkResponse({
    description: 'Cancelled customer order, or an idempotent replay.',
    type: CustomerOrderDetailResponseDto,
    headers: {
      'Cache-Control': {
        description: 'Always no-store for authenticated customer data.',
        schema: { type: 'string', example: 'no-store' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid order id or command body.',
    type: ApiErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token (`AUTH_UNAUTHENTICATED`).',
    type: ApiErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Wrong subject type (`AUTH_FORBIDDEN`).',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description:
      'Order not found or not owned by the caller (`ORDER_NOT_FOUND`).',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Order is not cancellable (`ORDER_INVALID_TRANSITION`).',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Unexpected failure (`INTERNAL_ERROR`).',
    type: ApiErrorResponseDto,
  })
  async cancel(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelOrderBodyDto,
  ): Promise<CustomerOrderDetailResponseDto> {
    void body;
    response.setHeader('Cache-Control', ORDER_CUSTOMER_CACHE_CONTROL);
    const ownerId = requireCustomerOwnerId(getAuthenticatedPrincipal(request));
    const result = await this.orderTransitions.cancelPendingOrderByCustomer({
      orderId: id,
      actor: { type: OrderActorType.USER, id: ownerId },
    });
    return { data: toCustomerOrderDetailDto(result.order) };
  }

  @Post()
  @UseGuards(AccessTokenGuard)
  @Header('Cache-Control', ORDER_CUSTOMER_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'Orders_create',
    summary:
      'Create a customer order (or replay an identical idempotent create)',
    description: [
      'Authenticated USER subjects only. Derives userId and USER actor exclusively from the authenticated principal — never from the body or query.',
      'An authenticated Admin (or other non-customer subject) is rejected with AUTH_FORBIDDEN (403).',
      'Request body accepts only regionId and lines `{ productId, quantity }`.',
      'Clients must not submit userId, actor, phone, prices, product names, discount ids, totals, status, or commerce-policy fields.',
      'Requires a UUID `Idempotency-Key` header. Same USER + key + normalized payload replays the committed Order without a second reservation or discount-usage consumption.',
      'Same key with a materially different payload returns ORDER_IDEMPOTENCY_CONFLICT.',
      'Commerce-policy rejection does not poison the key: a later valid attempt with the same key may succeed.',
      'Duplicate productIds are normalized by summing quantities before minimum-quantity, discount, and inventory checks.',
      'Response uses Cache-Control: no-store.',
      'CSRF protection is required for cookie-authenticated browser clients before production (shared AUTH production blocker; not implemented in ORD-03A).',
    ].join(' '),
  })
  @ApiCookieAuth('accessCookie')
  @ApiBearerAuth('bearer')
  @ApiHeader({
    name: 'Idempotency-Key',
    description:
      'Caller-provided UUID idempotency key scoped to the authenticated customer.',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({ type: CreateOrderBodyDto })
  @ApiCreatedResponse({
    description: 'Order created and inventory reserved.',
    type: CreateOrderResponseDto,
    headers: {
      'Cache-Control': {
        description: 'Always no-store for this mutation.',
        schema: { type: 'string', example: 'no-store' },
      },
    },
  })
  @ApiOkResponse({
    description:
      'Idempotent replay of a previously committed Order for the same key and payload.',
    type: CreateOrderResponseDto,
    headers: {
      'Cache-Control': {
        description: 'Always no-store for this mutation.',
        schema: { type: 'string', example: 'no-store' },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token (`AUTH_UNAUTHENTICATED`).',
    type: ApiErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Wrong subject type (`AUTH_FORBIDDEN`).',
    type: ApiErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: [
      'Validation failure, missing/invalid Idempotency-Key,',
      '`ORDER_INVALID_INPUT`, `ORDER_INVALID_USER`, `ORDER_INVALID_REGION`,',
      '`ORDER_INVALID_PRODUCT`, or related displayable create failures.',
    ].join(' '),
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: [
      '`ORDER_IDEMPOTENCY_CONFLICT`, `ORDERING_CLOSED`,',
      '`INVENTORY_INSUFFICIENT_STOCK`, or other Inventory reservation conflicts',
      'passthrough from the create path (for example `INVENTORY_RESERVATION_CONFLICT`).',
    ].join(' '),
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description:
      'Inventory row missing for a requested product (`INVENTORY_NOT_FOUND`) when reservation fails closed.',
    type: ApiErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: '`ORDER_MINIMUM_QUANTITY_NOT_MET`.',
    type: ApiErrorResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description: '`ORDERING_POLICY_UNAVAILABLE`.',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Unexpected failure (`INTERNAL_ERROR`).',
    type: ApiErrorResponseDto,
  })
  async create(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: CreateOrderBodyDto,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<CreateOrderResponseDto> {
    response.setHeader('Cache-Control', ORDER_CUSTOMER_CACHE_CONTROL);
    const ownerId = requireCustomerOwnerId(getAuthenticatedPrincipal(request));

    const result = await this.orderCreation.createOrder({
      actor: { type: OrderActorType.USER, id: ownerId },
      regionId: body.regionId,
      idempotencyKey,
      lines: body.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
      })),
    });

    response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);

    return { data: toCustomerOrderDto(result.order) };
  }
}

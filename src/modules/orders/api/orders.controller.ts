import {
  Body,
  Controller,
  Header,
  HttpStatus,
  Post,
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
import { OrderActorType } from '../domain/order-actor';
import { CreateOrderBodyDto } from './dto/create-order.dto';
import {
  CreateOrderResponseDto,
  toCustomerOrderDto,
} from './dto/customer-order-response.dto';
import { IdempotencyKey } from './idempotency-key.decorator';

const ORDER_MUTATION_CACHE_CONTROL = 'no-store';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orderCreation: OrderCreationService) {}

  @Post()
  @UseGuards(AccessTokenGuard)
  @Header('Cache-Control', ORDER_MUTATION_CACHE_CONTROL)
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
    response.setHeader('Cache-Control', ORDER_MUTATION_CACHE_CONTROL);
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

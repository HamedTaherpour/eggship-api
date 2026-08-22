import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
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
import { AdminPricingQueryService } from '../application/admin-pricing-query.service';
import { PricingService } from '../application/pricing.service';
import { AdminPriceHistoryListQueryDto } from './dto/admin-price-history-query.dto';
import {
  AdminProductPriceChangeResponseDto,
  ChangeProductPriceBodyDto,
} from './dto/change-product-price.dto';
import {
  AdminPriceHistoryListResponseDto,
  toAdminPriceHistoryItemDto,
} from './dto/price-history-response.dto';

@ApiTags('AdminPricing')
@Controller('admin/pricing')
@UseGuards(AccessTokenGuard, PermissionGuard)
@ApiCookieAuth('adminAccessCookie')
@ApiBearerAuth('bearer')
export class AdminPricingController {
  constructor(
    private readonly pricingQueries: AdminPricingQueryService,
    private readonly pricing: PricingService,
  ) {}

  @Get('products/:productId/price-history')
  @RequirePermissions(Permission.DISCOUNT_READ)
  @ApiOperation({
    operationId: 'AdminPricing_listPriceHistory',
    summary: 'List product price history (Admin)',
    description: [
      'Paginated append-only price history for one product, newest first.',
      'Stable tie-break uses row id descending when createdAt matches.',
      'Read-only; no update or delete. Requires DISCOUNT_READ.',
      'Returns PRODUCT_NOT_FOUND when the product id does not exist.',
    ].join(' '),
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOkResponse({
    description: 'Paginated price history.',
    type: AdminPriceHistoryListResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  async listPriceHistory(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: AdminPriceHistoryListQueryDto,
  ): Promise<InstanceType<typeof AdminPriceHistoryListResponseDto>> {
    const page = await this.pricingQueries.listPriceHistory(productId, query);
    return {
      data: page.data.map(toAdminPriceHistoryItemDto),
      meta: page.meta,
    };
  }

  @Patch('products/:productId/price')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.DISCOUNT_MANAGE)
  @ApiOperation({
    operationId: 'AdminPricing_changeProductPrice',
    summary: 'Change product price (Admin)',
    description: [
      'Sets Product.price and appends immutable PriceHistory when the price actually changes.',
      'No-op when the requested price equals the current price (no history row).',
      'Actor is taken from the authenticated Admin session — never from the request body.',
      'Requires DISCOUNT_MANAGE.',
      'Returns PRODUCT_NOT_FOUND when the product id does not exist.',
      'Returns PRODUCT_INVALID_PRICE for non-positive or non-integer prices.',
    ].join(' '),
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiBody({ type: ChangeProductPriceBodyDto })
  @ApiOkResponse({
    description: 'Price change result.',
    type: AdminProductPriceChangeResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  async changeProductPrice(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: ChangeProductPriceBodyDto,
    @Req() request: Request,
  ): Promise<AdminProductPriceChangeResponseDto> {
    const principal = getAuthenticatedPrincipal(request);
    const actor = this.pricing.requireAdminActor(principal!);
    const result = await this.pricing.changeProductPrice({
      productId,
      newPrice: body.price,
      actor,
    });
    return {
      data: {
        productId: result.product.id,
        price: result.product.price,
        historyWritten: result.historyWritten,
        updatedAt: result.product.updatedAt.toISOString(),
      },
    };
  }
}

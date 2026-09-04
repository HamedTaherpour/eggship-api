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
  ApiBearerAuth,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { Permission } from '../../../common/authz/permission';
import { PermissionGuard } from '../../../common/authz/permission.guard';
import { RequirePermissions } from '../../../common/authz/require-permissions.decorator';
import { ApiErrorResponseDto } from '../../../common/openapi/dto/common-response.dto';
import { AccessTokenGuard } from '../../auth/api/access-token.guard';
import {
  AnalyticsService,
  type AnalyticsCurrentStockResult,
  type AnalyticsDailyStockResult,
  type AnalyticsPriceHistoryResult,
} from '../application/analytics.service';
import { AnalyticsDateRangeQueryDto } from './dto/analytics-query.dto';
import {
  CurrentStockDto,
  DailyStockResponseDto,
  PriceHistoryResponseDto,
} from './dto/analytics-response.dto';

@ApiTags('AdminAnalytics')
@Controller('admin/analytics/products/:productId')
@UseGuards(AccessTokenGuard, PermissionGuard)
@RequirePermissions(Permission.ANALYTICS_READ)
@ApiCookieAuth('adminAccessCookie')
@ApiBearerAuth('bearer')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('stock')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'AdminAnalytics_getCurrentStock',
    summary: 'Get current product stock analytics',
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOkResponse({ type: CurrentStockDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async stock(@Param('productId', ParseUUIDPipe) id: string): Promise<{
    data: Omit<AnalyticsCurrentStockResult, 'updatedAt'> & {
      updatedAt: string;
    };
  }> {
    const result = await this.analytics.currentStock(id);
    return { data: { ...result, updatedAt: result.updatedAt.toISOString() } };
  }

  @Get('stock/daily')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'AdminAnalytics_getDailyStock',
    summary: 'Get daily product stock analytics in Tehran calendar days',
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOkResponse({ type: DailyStockResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async daily(
    @Param('productId', ParseUUIDPipe) id: string,
    @Query() query: AnalyticsDateRangeQueryDto,
  ): Promise<{ data: AnalyticsDailyStockResult }> {
    return { data: await this.analytics.dailyStock(id, query.from, query.to) };
  }

  @Get('price-history')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'AdminAnalytics_getPriceHistory',
    summary: 'Get product price changes and range anchor',
  })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOkResponse({ type: PriceHistoryResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async prices(
    @Param('productId', ParseUUIDPipe) id: string,
    @Query() query: AnalyticsDateRangeQueryDto,
  ): Promise<{
    data: Omit<
      AnalyticsPriceHistoryResult,
      'initialPrice' | 'priceAtRangeStart' | 'changes'
    > & {
      initialPrice: ReturnType<typeof serializeAnchor>;
      priceAtRangeStart: ReturnType<typeof serializeAnchor> | null;
      changes: {
        id: string;
        oldPrice: number;
        newPrice: number;
        changedAt: string;
      }[];
    };
  }> {
    const result = await this.analytics.priceHistory(id, query.from, query.to);
    return {
      data: {
        ...result,
        initialPrice: serializeAnchor(result.initialPrice),
        priceAtRangeStart: result.priceAtRangeStart
          ? serializeAnchor(result.priceAtRangeStart)
          : null,
        changes: result.changes.map((change) => ({
          ...change,
          changedAt: change.changedAt.toISOString(),
        })),
      },
    };
  }
}
function serializeAnchor(anchor: {
  price: number;
  effectiveAt: Date;
  inferred: boolean;
}): { price: number; effectiveAt: string; inferred: boolean } {
  return { ...anchor, effectiveAt: anchor.effectiveAt.toISOString() };
}

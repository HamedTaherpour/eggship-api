import { ApiProperty } from '@nestjs/swagger';

export class AnalyticsProductDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() isActive!: boolean;
}
export class CurrentStockDto {
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() onHand!: number;
  @ApiProperty() reserved!: number;
  @ApiProperty() available!: number;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class DailyStockItemDto {
  @ApiProperty() productId!: string;
  @ApiProperty() date!: string;
  @ApiProperty() openingStock!: number;
  @ApiProperty() received!: number;
  @ApiProperty() shipped!: number;
  @ApiProperty() returnedToStock!: number;
  @ApiProperty() writeOff!: number;
  @ApiProperty() adjustment!: number;
  @ApiProperty() closingStock!: number;
}
export class DailyStockResponseDto {
  @ApiProperty({ type: AnalyticsProductDto }) product!: AnalyticsProductDto;
  @ApiProperty({ type: [DailyStockItemDto] }) days!: DailyStockItemDto[];
}
export class InitialPriceAnchorDto {
  @ApiProperty() price!: number;
  @ApiProperty({ format: 'date-time' }) effectiveAt!: string;
  @ApiProperty() inferred!: boolean;
}
export class PriceChangeDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() oldPrice!: number;
  @ApiProperty() newPrice!: number;
  @ApiProperty({ format: 'date-time' }) changedAt!: string;
}
export class PriceHistoryResponseDto {
  @ApiProperty({ type: AnalyticsProductDto }) product!: AnalyticsProductDto;
  @ApiProperty() currentPrice!: number;
  @ApiProperty({ type: InitialPriceAnchorDto })
  initialPrice!: InitialPriceAnchorDto;
  @ApiProperty({ type: InitialPriceAnchorDto, nullable: true })
  priceAtRangeStart!: InitialPriceAnchorDto | null;
  @ApiProperty({ type: [PriceChangeDto] }) changes!: PriceChangeDto[];
}

export class AnalyticsSalesOverviewDto {
  @ApiProperty() ordersCreated!: number;
  @ApiProperty() createdOrderValue!: number | string;
  @ApiProperty() ordersConfirmed!: number;
  @ApiProperty() ordersShipped!: number;
  @ApiProperty() ordersDelivered!: number;
  @ApiProperty() ordersCancelled!: number;
  @ApiProperty() cancelledOrderValue!: number | string;
  @ApiProperty() grossSales!: number | string;
  @ApiProperty() lineDiscounts!: number | string;
  @ApiProperty() orderDiscounts!: number | string;
  @ApiProperty() totalDiscounts!: number | string;
  @ApiProperty() netSales!: number | string;
}

export class AnalyticsTopProductDto {
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() value!: number | string;
}

export class AnalyticsTopProductsResponseDto {
  @ApiProperty({
    enum: ['DELIVERED_QUANTITY', 'DELIVERED_VALUE', 'SHIPPED_QUANTITY'],
  })
  basis!: string;
  @ApiProperty({ type: [AnalyticsTopProductDto] })
  items!: AnalyticsTopProductDto[];
}

export class AnalyticsTodayPulseDto extends AnalyticsSalesOverviewDto {
  @ApiProperty() stockReceived!: number;
  @ApiProperty() stockShipped!: number;
  @ApiProperty() stockReturnedToStock!: number;
  @ApiProperty() awaitingReviewCurrent!: number;
}

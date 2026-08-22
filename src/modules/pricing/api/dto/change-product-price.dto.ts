import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import {
  PRODUCT_PRICE_MAX_TOMAN,
  PRODUCT_PRICE_MIN_TOMAN,
} from '../../../products/domain/product-price';

export class ChangeProductPriceBodyDto {
  @ApiProperty({
    description:
      'New selling price as an integer number of Toman. Committed changes append immutable PriceHistory with the server-read previous price.',
    minimum: PRODUCT_PRICE_MIN_TOMAN,
    maximum: PRODUCT_PRICE_MAX_TOMAN,
    example: 650000,
    type: Number,
  })
  @IsInt()
  @Min(PRODUCT_PRICE_MIN_TOMAN)
  @Max(PRODUCT_PRICE_MAX_TOMAN)
  price!: number;
}

export class AdminProductPriceChangeDto {
  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({
    description: 'Current price in integer Toman after the operation.',
  })
  price!: number;

  @ApiProperty({
    description:
      'Whether a new PriceHistory row was written. False when the requested price equals the current price (no-op).',
  })
  historyWritten!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class AdminProductPriceChangeResponseDto {
  @ApiProperty({ type: AdminProductPriceChangeDto })
  data!: AdminProductPriceChangeDto;
}

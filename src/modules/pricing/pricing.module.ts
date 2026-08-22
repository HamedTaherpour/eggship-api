import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { CategoriesModule } from '../categories/categories.module';
import { ProductsModule } from '../products/products.module';
import { DiscountService } from './application/discount.service';
import { PricingService } from './application/pricing.service';
import { DiscountRepository } from './infrastructure/discount.repository';
import { PriceHistoryRepository } from './infrastructure/price-history.repository';

/**
 * Product price mutations with durable PriceHistory (PRC-01) and Discount
 * persistence/lifecycle (PRC-02), and pure discount calculation (PRC-03).
 * Admin HTTP is PRC-04; Order snapshot integration is PRC-05.
 */
@Module({
  imports: [PrismaModule, forwardRef(() => ProductsModule), CategoriesModule],
  providers: [
    PriceHistoryRepository,
    PricingService,
    DiscountRepository,
    DiscountService,
  ],
  exports: [
    PricingService,
    PriceHistoryRepository,
    DiscountService,
    DiscountRepository,
  ],
})
export class PricingModule {}

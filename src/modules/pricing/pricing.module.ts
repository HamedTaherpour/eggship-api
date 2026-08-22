import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';
import { ProductsModule } from '../products/products.module';
import { AdminDiscountsController } from './api/admin-discounts.controller';
import { AdminPricingController } from './api/admin-pricing.controller';
import { AdminPricingQueryService } from './application/admin-pricing-query.service';
import { DiscountService } from './application/discount.service';
import { PricingService } from './application/pricing.service';
import { DiscountRepository } from './infrastructure/discount.repository';
import { PriceHistoryRepository } from './infrastructure/price-history.repository';

/**
 * Product price mutations with durable PriceHistory (PRC-01) and Discount
 * persistence/lifecycle (PRC-02), pure discount calculation (PRC-03), and
 * Admin pricing/discount HTTP APIs (PRC-04). Order snapshot integration is PRC-05.
 */
@Module({
  imports: [
    PrismaModule,
    forwardRef(() => ProductsModule),
    CategoriesModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [AdminPricingController, AdminDiscountsController],
  providers: [
    PriceHistoryRepository,
    PricingService,
    AdminPricingQueryService,
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

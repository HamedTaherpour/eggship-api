import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';
import { ProductsModule } from '../products/products.module';
import { AdminDiscountsController } from './api/admin-discounts.controller';
import { AdminPricingController } from './api/admin-pricing.controller';
import { AdminPricingQueryService } from './application/admin-pricing-query.service';
import { DiscountService } from './application/discount.service';
import { OrderPricingService } from './application/order-pricing.service';
import { PricingService } from './application/pricing.service';
import { DiscountRepository } from './infrastructure/discount.repository';
import { PriceHistoryRepository } from './infrastructure/price-history.repository';

/**
 * Product price mutations with durable PriceHistory (PRC-01) and Discount
 * persistence/lifecycle (PRC-02), pure discount calculation (PRC-03),
 * Admin pricing/discount HTTP APIs (PRC-04), and persistence-neutral order
 * pricing composition for ORD-03 (PRC-05).
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
    OrderPricingService,
  ],
  exports: [
    PricingService,
    PriceHistoryRepository,
    DiscountService,
    DiscountRepository,
    OrderPricingService,
  ],
})
export class PricingModule {}

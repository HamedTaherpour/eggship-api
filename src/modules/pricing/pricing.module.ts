import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { ProductsModule } from '../products/products.module';
import { PricingService } from './application/pricing.service';
import { PriceHistoryRepository } from './infrastructure/price-history.repository';

/**
 * Product price mutations with durable PriceHistory (PRC-01).
 * Discount calculation and admin history read APIs are later PRC tasks.
 */
@Module({
  imports: [PrismaModule, forwardRef(() => ProductsModule)],
  providers: [PriceHistoryRepository, PricingService],
  exports: [PricingService, PriceHistoryRepository],
})
export class PricingModule {}

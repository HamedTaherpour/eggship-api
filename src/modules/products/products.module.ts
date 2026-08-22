import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PricingModule } from '../pricing/pricing.module';
import { AdminProductsController } from './api/admin-products.controller';
import { ProductsController } from './api/products.controller';
import { ProductService } from './application/product.service';
import { ProductRepository } from './infrastructure/product.repository';

/**
 * Product catalog resource (CAT-03).
 * Owns identity, Category relationship, and current integer-Toman price.
 * Price mutations with history route through PricingModule (PRC-01).
 * Inventory quantities stay in InventoryModule (INV-01B). Media deferred
 * (CAT-04). AuthModule is imported only so Admin routes can resolve
 * AccessTokenGuard.
 */
@Module({
  imports: [
    PrismaModule,
    CategoriesModule,
    InventoryModule,
    forwardRef(() => PricingModule),
    forwardRef(() => AuthModule),
  ],
  controllers: [ProductsController, AdminProductsController],
  providers: [ProductRepository, ProductService],
  exports: [ProductService, ProductRepository],
})
export class ProductsModule {}

import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { CommercePolicyModule } from '../commerce-policy/commerce-policy.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PricingModule } from '../pricing/pricing.module';
import { RegionsModule } from '../regions/regions.module';
import { UsersModule } from '../users/users.module';
import { OrderCreationService } from './application/order-creation.service';
import { OrderTransitionService } from './application/order-transition.service';
import { OrderRepository } from './infrastructure/order.repository';

/**
 * Order persistence, historical snapshots, creation (ORD-03 + COM-03), and
 * transitions (ORD-02). HTTP belongs to ORD-03A–ORD-06. Inventory tables are
 * mutated only through InventoryService contracts; pricing via
 * OrderPricingService; acceptance via CommercePolicyService.
 */
@Module({
  imports: [
    PrismaModule,
    CommercePolicyModule,
    InventoryModule,
    PricingModule,
    UsersModule,
    forwardRef(() => RegionsModule),
  ],
  providers: [OrderRepository, OrderCreationService, OrderTransitionService],
  exports: [OrderRepository, OrderCreationService, OrderTransitionService],
})
export class OrdersModule {}

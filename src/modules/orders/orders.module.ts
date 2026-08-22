import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PricingModule } from '../pricing/pricing.module';
import { RegionsModule } from '../regions/regions.module';
import { UsersModule } from '../users/users.module';
import { OrderCreationService } from './application/order-creation.service';
import { OrderTransitionService } from './application/order-transition.service';
import { OrderRepository } from './infrastructure/order.repository';

/**
 * Order persistence, historical snapshots, creation (ORD-03), and transitions
 * (ORD-02). HTTP belongs to ORD-04–ORD-06. Inventory tables are mutated only
 * through InventoryService contracts; pricing via OrderPricingService.
 */
@Module({
  imports: [
    PrismaModule,
    InventoryModule,
    PricingModule,
    UsersModule,
    forwardRef(() => RegionsModule),
  ],
  providers: [OrderRepository, OrderCreationService, OrderTransitionService],
  exports: [OrderRepository, OrderCreationService, OrderTransitionService],
})
export class OrdersModule {}

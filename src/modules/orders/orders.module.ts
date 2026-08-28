import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CommercePolicyModule } from '../commerce-policy/commerce-policy.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PricingModule } from '../pricing/pricing.module';
import { RegionsModule } from '../regions/regions.module';
import { UsersModule } from '../users/users.module';
import { OrdersController } from './api/orders.controller';
import { AdminOrdersController } from './api/admin-orders.controller';
import { OrderCreationService } from './application/order-creation.service';
import { OrderReadService } from './application/order-read.service';
import { OrderTransitionService } from './application/order-transition.service';
import { OrderRepository } from './infrastructure/order.repository';

/**
 * Order persistence, historical snapshots, creation (ORD-03 + COM-03 + DLU-02),
 * customer create HTTP (ORD-03A), customer read HTTP (ORD-04), and transitions
 * (ORD-02), and customer cancellation HTTP (ORD-05). Admin transition HTTP
 * belongs to ORD-06. Inventory tables are
 * mutated only through InventoryService contracts; pricing via OrderPricingService;
 * acceptance via CommercePolicyService.
 */
@Module({
  imports: [
    PrismaModule,
    forwardRef(() => AuthModule),
    CommercePolicyModule,
    InventoryModule,
    PricingModule,
    UsersModule,
    forwardRef(() => RegionsModule),
  ],
  controllers: [OrdersController, AdminOrdersController],
  providers: [
    OrderRepository,
    OrderCreationService,
    OrderReadService,
    OrderTransitionService,
  ],
  exports: [
    OrderRepository,
    OrderCreationService,
    OrderReadService,
    OrderTransitionService,
  ],
})
export class OrdersModule {}

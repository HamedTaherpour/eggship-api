import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrderTransitionService } from './application/order-transition.service';
import { OrderRepository } from './infrastructure/order.repository';

/**
 * Order persistence, historical snapshots, and transition orchestration (ORD-02).
 * HTTP belongs to ORD-04–ORD-06. Inventory tables are mutated only through
 * InventoryService contracts.
 */
@Module({
  imports: [PrismaModule, InventoryModule],
  providers: [OrderRepository, OrderTransitionService],
  exports: [OrderRepository, OrderTransitionService],
})
export class OrdersModule {}

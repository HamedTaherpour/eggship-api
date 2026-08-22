import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { OrderRepository } from './infrastructure/order.repository';

/**
 * Order persistence with immutable historical snapshots (ORD-01).
 * State transitions and HTTP belong to ORD-02+; Inventory orchestration to ORD-03.
 */
@Module({
  imports: [PrismaModule],
  providers: [OrderRepository],
  exports: [OrderRepository],
})
export class OrdersModule {}

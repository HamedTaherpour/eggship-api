import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AdminInventoryOperationsService } from './application/admin-inventory-operations.service';
import { AdminInventoryQueryService } from './application/admin-inventory-query.service';
import { InventoryReconciliationService } from './application/inventory-reconciliation.service';
import { InventoryService } from './application/inventory.service';
import { AdminInventoryController } from './api/admin-inventory.controller';
import { InventoryBalanceRepository } from './infrastructure/inventory-balance.repository';
import { InventoryCommandIdempotencyRepository } from './infrastructure/inventory-command-idempotency.repository';
import { InventoryLedgerRepository } from './infrastructure/inventory-ledger.repository';
import { InventoryReservationRepository } from './infrastructure/inventory-reservation.repository';

/**
 * Inventory quantities, reservations, ledger, and Admin warehouse commands.
 * Orders must orchestrate stock mutations through InventoryService — not tables.
 */
@Module({
  imports: [PrismaModule, forwardRef(() => AuthModule)],
  controllers: [AdminInventoryController],
  providers: [
    InventoryBalanceRepository,
    InventoryReservationRepository,
    InventoryLedgerRepository,
    InventoryCommandIdempotencyRepository,
    InventoryService,
    AdminInventoryOperationsService,
    AdminInventoryQueryService,
    InventoryReconciliationService,
  ],
  exports: [InventoryService, InventoryReconciliationService],
})
export class InventoryModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { InventoryService } from './application/inventory.service';
import { InventoryBalanceRepository } from './infrastructure/inventory-balance.repository';
import { InventoryLedgerRepository } from './infrastructure/inventory-ledger.repository';
import { InventoryReservationRepository } from './infrastructure/inventory-reservation.repository';

/**
 * Inventory quantity, reservation, and ledger persistence (INV-01B).
 * No HTTP surface. Orders must orchestrate through InventoryService.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    InventoryBalanceRepository,
    InventoryReservationRepository,
    InventoryLedgerRepository,
    InventoryService,
  ],
  exports: [InventoryService],
})
export class InventoryModule {}

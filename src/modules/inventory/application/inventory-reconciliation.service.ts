import { Injectable } from '@nestjs/common';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { TransactionRunner } from '../../../infrastructure/database/transaction';
import {
  reconcileInventorySnapshot,
  type InventoryReconciliationResult,
} from '../domain/inventory-reconciliation';
import { InventoryNotFoundError } from '../domain/inventory-errors';
import { InventoryHttpMessage } from '../domain/inventory-http-messages';
import { assertInventoryUuid } from '../domain/inventory-quantity';
import { InventoryBalanceRepository } from '../infrastructure/inventory-balance.repository';
import { InventoryLedgerRepository } from '../infrastructure/inventory-ledger.repository';
import { InventoryReservationRepository } from '../infrastructure/inventory-reservation.repository';

/**
 * Read-only inventory reconciliation (INV-05). Compares current balances,
 * ACTIVE reservation aggregates, and append-only ledger history. Never mutates
 * stock or ledger rows.
 */
@Injectable()
export class InventoryReconciliationService {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly balances: InventoryBalanceRepository,
    private readonly reservations: InventoryReservationRepository,
    private readonly ledger: InventoryLedgerRepository,
    private readonly logger: ApplicationLogger,
  ) {}

  async reconcileProduct(
    productId: string,
  ): Promise<InventoryReconciliationResult> {
    const id = assertInventoryUuid(productId, 'productId');
    const startedAt = Date.now();

    const result = await this.transactions.runSnapshotRead(async (ctx) => {
      const balance = await this.balances.findByProductId(id, ctx);
      if (balance === null) {
        throw new InventoryNotFoundError(InventoryHttpMessage.NOT_FOUND, {
          productId: id,
        });
      }

      const [reservationRows, ledgerRows] = await Promise.all([
        this.reservations.listByProduct(id, ctx),
        this.ledger.listByProduct(id, ctx),
      ]);

      return reconcileInventorySnapshot({
        productId: id,
        onHand: balance.onHand,
        reserved: balance.reserved,
        reservations: reservationRows,
        ledger: ledgerRows,
        checkedAt: new Date(),
      });
    });

    const durationMs = Date.now() - startedAt;
    const consistent = result.status === 'CONSISTENT';

    this.logger.info(
      {
        module: 'inventory',
        operation: 'inventory.reconciliation.completed',
        productId: id,
        consistent,
        issueCount: result.issues.length,
        durationMs,
      },
      'Inventory reconciliation completed',
    );

    if (!consistent) {
      this.logger.info(
        {
          module: 'inventory',
          operation: 'inventory.reconciliation.inconsistent',
          productId: id,
          issueCount: result.issues.length,
          issueCodes: result.issues.map((issue) => issue.code),
        },
        'Inventory reconciliation found inconsistencies',
      );
    }

    return result;
  }
}

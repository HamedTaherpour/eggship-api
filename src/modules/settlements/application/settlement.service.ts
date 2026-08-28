import { Injectable } from '@nestjs/common';
import {
  resolvePageRequest,
  toPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/list';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { TransactionRunner } from '../../../infrastructure/database/transaction';
import { MediaService } from '../../media/application/media.service';
import { OrderNotFoundError } from '../../orders/domain/order-errors';
import { OrderStatus } from '../../orders/domain/order-status';
import type { AdminSettlementListQueryDto } from '../api/dto/admin-settlement-list-query.dto';
import { resolveSettlementSort } from '../api/dto/admin-settlement-list-query.dto';
import { parseSettlementDueAt } from '../domain/due-date';
import {
  SettlementAlreadyExistsError,
  SettlementInvalidTransitionError,
  SettlementNotFoundError,
  SettlementOrderNotDeliveredError,
  SettlementReceiptRequiredError,
} from '../domain/settlement-errors';
import { SettlementStatus, type SettlementRecord } from '../domain/settlement';
import {
  isSettlementUniqueViolation,
  SettlementRepository,
} from '../infrastructure/settlement.repository';

@Injectable()
export class SettlementService {
  constructor(
    private readonly settlements: SettlementRepository,
    private readonly transactions: TransactionRunner,
    private readonly media: MediaService,
    private readonly logger: ApplicationLogger,
  ) {}

  async listAdmin(
    query: AdminSettlementListQueryDto,
  ): Promise<PaginatedResponse<SettlementRecord>> {
    const pageRequest = resolvePageRequest(query);
    const sort = resolveSettlementSort(query);
    const now = new Date();
    const page = await this.settlements.list({
      ...pageRequest,
      ...sort,
      status: query.status,
      overdue: query.overdue,
      orderId: query.orderId,
      dueFrom:
        query.dueFrom === undefined
          ? undefined
          : parseSettlementDueAt(query.dueFrom),
      dueTo:
        query.dueTo === undefined
          ? undefined
          : parseSettlementDueAt(query.dueTo),
      now,
    });
    return toPaginatedResponse(page.items, pageRequest, page.total);
  }

  async getAdminById(id: string): Promise<SettlementRecord> {
    const found = await this.settlements.findById(id);
    if (found === null) throw new SettlementNotFoundError();
    return found;
  }

  async create(
    orderId: string,
    dueAtValue: string,
    actorId: string,
  ): Promise<SettlementRecord> {
    const dueAt = parseSettlementDueAt(dueAtValue);
    try {
      const created = await this.transactions.run(async (tx) => {
        const order = await this.settlements.lockOrder(orderId, tx);
        if (order === null) throw new OrderNotFoundError();
        if (order.status !== OrderStatus.DELIVERED) {
          throw new SettlementOrderNotDeliveredError();
        }
        if ((await this.settlements.findByOrderId(orderId, tx)) !== null) {
          throw new SettlementAlreadyExistsError();
        }
        return this.settlements.create({ orderId, dueAt, actorId }, tx);
      });
      this.logger.info(
        {
          module: 'settlements',
          operation: 'settlement.created',
          settlementId: created.id,
          orderId: created.orderId,
          dueAt: created.dueAt.toISOString(),
          actorId,
        },
        'Settlement created',
      );
      return created;
    } catch (error: unknown) {
      if (isSettlementUniqueViolation(error)) {
        throw new SettlementAlreadyExistsError();
      }
      throw error;
    }
  }

  async changeDueAt(
    id: string,
    dueAtValue: string,
    actorId: string,
  ): Promise<SettlementRecord> {
    const dueAt = parseSettlementDueAt(dueAtValue);
    const result = await this.transactions.run(async (tx) => {
      const changed = await this.settlements.changeDueAt(id, dueAt, tx);
      if (changed !== null) return changed;
      const current = await this.requireCurrent(id, tx);
      if (current.status !== SettlementStatus.OPEN) {
        throw new SettlementInvalidTransitionError();
      }
      throw new Error('Open settlement due-date update did not complete.');
    });
    this.logger.info(
      {
        module: 'settlements',
        operation: 'settlement.due_date_changed',
        settlementId: id,
        oldDueAt: result.previousDueAt.toISOString(),
        dueAt: result.record.dueAt.toISOString(),
        actorId,
      },
      'Settlement due date changed',
    );
    return result.record;
  }

  async attachReceipt(
    id: string,
    mediaId: string,
    actorId: string,
  ): Promise<SettlementRecord> {
    const result = await this.transactions.run(async (tx) => {
      const before = await this.requireCurrent(id, tx);
      if (before.status !== SettlementStatus.OPEN) {
        throw new SettlementInvalidTransitionError();
      }
      await this.media.getReceiptReference(mediaId, tx);
      const changed = await this.settlements.attachReceipt(
        id,
        mediaId,
        actorId,
        tx,
      );
      if (changed !== null)
        return {
          kind:
            changed.previousReceiptMediaId === null ? 'attached' : 'replaced',
          record: changed.record,
        } as const;

      const current = await this.requireCurrent(id, tx);
      if (current.status !== SettlementStatus.OPEN) {
        throw new SettlementInvalidTransitionError();
      }
      if (current.receiptMediaId === mediaId) {
        return { kind: 'replay', record: current } as const;
      }
      throw new Error('Open settlement receipt update did not complete.');
    });

    if (result.kind !== 'replay') {
      this.logger.info(
        {
          module: 'settlements',
          operation:
            result.kind === 'attached'
              ? 'settlement.receipt_attached'
              : 'settlement.receipt_replaced',
          settlementId: id,
          receiptMediaId: mediaId,
          actorId,
        },
        result.kind === 'attached'
          ? 'Settlement receipt attached'
          : 'Settlement receipt replaced',
      );
    }
    return result.record;
  }

  async markSettled(id: string, actorId: string): Promise<SettlementRecord> {
    const result = await this.transactions.run(async (tx) => {
      const settled = await this.settlements.markSettled(id, actorId, tx);
      if (settled !== null) return { changed: true, record: settled };
      const current = await this.requireCurrent(id, tx);
      if (current.status === SettlementStatus.SETTLED) {
        return { changed: false, record: current };
      }
      if (current.receiptMediaId === null) {
        throw new SettlementReceiptRequiredError();
      }
      throw new SettlementInvalidTransitionError();
    });
    if (result.changed) {
      this.logger.info(
        {
          module: 'settlements',
          operation: 'settlement.settled',
          settlementId: id,
          actorId,
        },
        'Settlement marked settled',
      );
    }
    return result.record;
  }

  private async requireCurrent(
    id: string,
    tx: Parameters<SettlementRepository['findById']>[1],
  ): Promise<SettlementRecord> {
    const current = await this.settlements.findById(id, tx);
    if (current === null) throw new SettlementNotFoundError();
    return current;
  }
}

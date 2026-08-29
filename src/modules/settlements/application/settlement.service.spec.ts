import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import {
  TRANSACTION_CONTEXT_BRAND,
  type TransactionContext,
  TransactionRunner,
} from '../../../infrastructure/database/transaction';
import type { MediaService } from '../../media/application/media.service';
import { MediaNotFoundError } from '../../media/domain/media-errors';
import { OrderNotFoundError } from '../../orders/domain/order-errors';
import { OrderStatus } from '../../orders/domain/order-status';
import { SettlementStatus, type SettlementRecord } from '../domain/settlement';
import {
  SettlementAlreadyExistsError,
  SettlementInvalidTransitionError,
  SettlementOrderNotDeliveredError,
  SettlementReceiptRequiredError,
} from '../domain/settlement-errors';
import type { SettlementRepository } from '../infrastructure/settlement.repository';
import { SettlementService } from './settlement.service';

const tx: TransactionContext = { [TRANSACTION_CONTEXT_BRAND]: true };

class ImmediateTransactions extends TransactionRunner {
  run<T>(fn: (context: TransactionContext) => Promise<T>): Promise<T> {
    return fn(tx);
  }
  runIn<T>(
    _existing: TransactionContext | undefined,
    fn: (context: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return fn(tx);
  }
  runSnapshotRead<T>(
    fn: (context: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return fn(tx);
  }
  runRepeatableRead<T>(
    fn: (context: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return fn(tx);
  }
}

function record(overrides: Partial<SettlementRecord> = {}): SettlementRecord {
  const now = new Date('2026-08-27T10:00:00.000Z');
  return {
    id: '11111111-1111-4111-8111-111111111111',
    orderId: '22222222-2222-4222-8222-222222222222',
    orderStatus: OrderStatus.DELIVERED,
    orderTotal: 10_000n,
    status: SettlementStatus.OPEN,
    dueAt: new Date('2026-08-28T10:00:00.000Z'),
    overdue: false,
    settledAt: null,
    settledByAdminId: null,
    receiptMediaId: null,
    receiptAttachedAt: null,
    receiptAttachedByAdminId: null,
    createdByAdminId: '33333333-3333-4333-8333-333333333333',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('SettlementService', () => {
  let repository: {
    lockOrder: jest.Mock;
    lockForUpdate: jest.Mock;
    findByOrderId: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    changeDueAt: jest.Mock;
    attachReceipt: jest.Mock;
    markSettled: jest.Mock;
    list: jest.Mock;
  };
  let media: { getReceiptReference: jest.Mock };
  let logger: { info: jest.Mock };
  let service: SettlementService;

  beforeEach(() => {
    repository = {
      lockOrder: jest.fn(),
      lockForUpdate: jest.fn(),
      findByOrderId: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      changeDueAt: jest.fn(),
      attachReceipt: jest.fn(),
      markSettled: jest.fn(),
      list: jest.fn(),
    };
    media = { getReceiptReference: jest.fn() };
    logger = { info: jest.fn() };
    service = new SettlementService(
      repository as unknown as SettlementRepository,
      new ImmediateTransactions(),
      media as unknown as MediaService,
      logger as unknown as ApplicationLogger,
    );
  });

  it('creates OPEN only after locking a delivered Order and emits a safe event', async () => {
    const created = record();
    repository.lockOrder.mockResolvedValue({
      id: created.orderId,
      status: OrderStatus.DELIVERED,
    });
    repository.findByOrderId.mockResolvedValue(null);
    repository.create.mockResolvedValue(created);

    await expect(
      service.create(
        created.orderId,
        created.dueAt.toISOString(),
        created.createdByAdminId,
      ),
    ).resolves.toBe(created);
    expect(repository.create).toHaveBeenCalledWith(
      {
        orderId: created.orderId,
        dueAt: created.dueAt,
        actorId: created.createdByAdminId,
      },
      tx,
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'settlement.created',
        settlementId: created.id,
      }),
      'Settlement created',
    );
  });

  it('rejects missing, non-delivered, and duplicate Orders', async () => {
    repository.lockOrder.mockResolvedValueOnce(null);
    await expect(
      service.create(
        record().orderId,
        record().dueAt.toISOString(),
        record().createdByAdminId,
      ),
    ).rejects.toBeInstanceOf(OrderNotFoundError);

    repository.lockOrder.mockResolvedValueOnce({
      id: record().orderId,
      status: OrderStatus.SHIPPED,
    });
    await expect(
      service.create(
        record().orderId,
        record().dueAt.toISOString(),
        record().createdByAdminId,
      ),
    ).rejects.toBeInstanceOf(SettlementOrderNotDeliveredError);

    repository.lockOrder.mockResolvedValueOnce({
      id: record().orderId,
      status: OrderStatus.DELIVERED,
    });
    repository.findByOrderId.mockResolvedValueOnce(record());
    await expect(
      service.create(
        record().orderId,
        record().dueAt.toISOString(),
        record().createdByAdminId,
      ),
    ).rejects.toBeInstanceOf(SettlementAlreadyExistsError);
  });

  it('changes dueAt only while OPEN', async () => {
    const before = record();
    const changed = record({ dueAt: new Date('2026-09-01T00:00:00.000Z') });
    repository.findById.mockResolvedValue(before);
    repository.changeDueAt.mockResolvedValue({
      record: changed,
      previousDueAt: before.dueAt,
    });
    await expect(
      service.changeDueAt(
        before.id,
        changed.dueAt.toISOString(),
        before.createdByAdminId,
      ),
    ).resolves.toBe(changed);

    repository.findById.mockResolvedValue(
      record({ status: SettlementStatus.SETTLED }),
    );
    repository.changeDueAt.mockResolvedValueOnce(null);
    await expect(
      service.changeDueAt(
        before.id,
        changed.dueAt.toISOString(),
        before.createdByAdminId,
      ),
    ).rejects.toBeInstanceOf(SettlementInvalidTransitionError);
  });

  it('attaches, replaces, and treats same-Media replay as a no-op', async () => {
    const open = record();
    const mediaId = '44444444-4444-4444-8444-444444444444';
    const attached = record({
      receiptMediaId: mediaId,
      receiptAttachedAt: new Date(),
      receiptAttachedByAdminId: open.createdByAdminId,
    });
    repository.findById.mockResolvedValue(open);
    repository.lockForUpdate.mockResolvedValue(open);
    media.getReceiptReference.mockResolvedValue({ id: mediaId });
    repository.attachReceipt.mockResolvedValue({
      record: attached,
      previousReceiptMediaId: null,
    });
    await expect(
      service.attachReceipt(open.id, mediaId, open.createdByAdminId),
    ).resolves.toBe(attached);

    repository.attachReceipt.mockResolvedValue(null);
    repository.findById
      .mockResolvedValueOnce(attached)
      .mockResolvedValueOnce(attached);
    logger.info.mockClear();
    await expect(
      service.attachReceipt(open.id, mediaId, open.createdByAdminId),
    ).resolves.toBe(attached);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('does not attach nonexistent Media or edit a settled receipt', async () => {
    repository.findById.mockResolvedValue(record());
    repository.lockForUpdate.mockResolvedValue(record());
    media.getReceiptReference.mockRejectedValue(new MediaNotFoundError());
    await expect(
      service.attachReceipt(
        record().id,
        '44444444-4444-4444-8444-444444444444',
        record().createdByAdminId,
      ),
    ).rejects.toBeInstanceOf(MediaNotFoundError);

    repository.findById.mockResolvedValue(
      record({ status: SettlementStatus.SETTLED }),
    );
    repository.lockForUpdate.mockResolvedValue(
      record({ status: SettlementStatus.SETTLED }),
    );
    await expect(
      service.attachReceipt(
        record().id,
        '44444444-4444-4444-8444-444444444444',
        record().createdByAdminId,
      ),
    ).rejects.toBeInstanceOf(SettlementInvalidTransitionError);
  });

  it('requires a receipt, settles once, and preserves settled replay stamps', async () => {
    repository.markSettled.mockResolvedValueOnce(null);
    repository.findById.mockResolvedValueOnce(record());
    await expect(
      service.markSettled(record().id, record().createdByAdminId),
    ).rejects.toBeInstanceOf(SettlementReceiptRequiredError);

    const settled = record({
      status: SettlementStatus.SETTLED,
      receiptMediaId: '44444444-4444-4444-8444-444444444444',
      receiptAttachedAt: new Date(),
      receiptAttachedByAdminId: record().createdByAdminId,
      settledAt: new Date(),
      settledByAdminId: record().createdByAdminId,
    });
    repository.markSettled.mockResolvedValueOnce(settled);
    await expect(
      service.markSettled(settled.id, settled.createdByAdminId),
    ).resolves.toBe(settled);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'settlement.settled' }),
      'Settlement marked settled',
    );

    logger.info.mockClear();
    repository.markSettled.mockResolvedValueOnce(null);
    repository.findById.mockResolvedValueOnce(settled);
    await expect(
      service.markSettled(settled.id, settled.createdByAdminId),
    ).resolves.toBe(settled);
    expect(logger.info).not.toHaveBeenCalled();
  });
});

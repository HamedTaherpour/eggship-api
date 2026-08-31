import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { TransactionRunner } from '../../../infrastructure/database/transaction';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import { AuditLogService } from '../../audit/application/audit-log.service';
import { AuditAction, AuditEntityType } from '../../audit/domain/audit-event';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import { AuthSubjectType } from '../../auth/domain/subject-type';
import type { InventoryBalance } from '../domain/inventory-balance';
import {
  hashAdjustPayload,
  hashReceivePayload,
  InventoryCommandIdempotencyStatus,
  InventoryCommandOperation,
  toBalanceFromIdempotency,
  type InventoryCommandIdempotencyRecord,
} from '../domain/inventory-command-idempotency';
import {
  IdempotencyConflictError,
  InventoryErrorCode,
  InventoryInvalidAdjustmentError,
  InventoryInvalidQuantityError,
  InventoryNotFoundError,
} from '../domain/inventory-errors';
import { InventoryHttpMessage } from '../domain/inventory-http-messages';
import {
  InventoryLedgerActorType,
  InventoryLedgerReferenceType,
  assertLedgerActor,
  normalizeLedgerReason,
  type InventoryActor,
} from '../domain/inventory-ledger';
import {
  assertAdjustmentDelta,
  assertInventoryUuid,
  assertPositiveQuantity,
  isInventoryUuid,
} from '../domain/inventory-quantity';
import { InventoryCommandIdempotencyRepository } from '../infrastructure/inventory-command-idempotency.repository';
import { InventoryService } from './inventory.service';

export interface ReceiveStockCommand {
  productId: string;
  quantity: number;
  idempotencyKey: string;
  principal: AuthenticatedPrincipal;
}

export interface AdjustStockCommand {
  productId: string;
  delta: number;
  reason: string;
  idempotencyKey: string;
  principal: AuthenticatedPrincipal;
}

/**
 * Admin warehouse inventory commands (INV-02). Orchestrates idempotency,
 * actor metadata, and InventoryService primitives inside one PostgreSQL
 * transaction per successful mutation.
 */
@Injectable()
export class AdminInventoryOperationsService {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly inventory: InventoryService,
    private readonly idempotency: InventoryCommandIdempotencyRepository,
    private readonly logger: ApplicationLogger,
    @Optional() private readonly audit?: AuditLogService,
  ) {}

  async getBalance(productId: string): Promise<InventoryBalance> {
    const id = assertInventoryUuid(productId, 'productId');
    const balance = await this.inventory.getBalance(id);
    if (balance === null) {
      throw new InventoryNotFoundError(InventoryHttpMessage.NOT_FOUND, {
        productId: id,
      });
    }
    return balance;
  }

  async receiveStock(input: ReceiveStockCommand): Promise<InventoryBalance> {
    const productId = assertInventoryUuid(input.productId, 'productId');
    const quantity = assertPositiveQuantity(input.quantity);
    const idempotencyKey = this.requireIdempotencyKey(input.idempotencyKey);
    const actor = this.requireAdminActor(input.principal);
    const payloadHash = hashReceivePayload({ productId, quantity });

    return this.transactions.run(async (ctx) => {
      const replay = await this.claimOrReplay({
        idempotencyKey,
        operation: InventoryCommandOperation.RECEIVE,
        productId,
        payloadHash,
        ctx,
      });
      if (replay !== null) {
        return this.enrichReplayBalance(replay, productId, ctx);
      }

      try {
        const result = await this.inventory.receiveOnHand(
          {
            productId,
            quantity,
            referenceType: InventoryLedgerReferenceType.RECEIVE,
            referenceId: idempotencyKey,
            actor,
            correlationId: idempotencyKey,
          },
          ctx,
        );

        await this.audit?.append(
          {
            action: AuditAction.INVENTORY_RECEIVED,
            actorType: actor.type,
            actorId: actor.id,
            entityType: AuditEntityType.INVENTORY,
            entityId: productId,
            metadata: undefined,
          },
          ctx,
        );

        await this.idempotency.markCompleted(
          {
            idempotencyKey,
            onHandAfter: result.balance.onHand,
            reservedAfter: result.balance.reserved,
            ledgerId: result.ledger.id,
          },
          ctx,
        );

        this.logger.info(
          {
            module: 'inventory',
            operation: 'inventory.receive.succeeded',
            productId,
            quantity,
          },
          'Stock received',
        );

        return result.balance;
      } catch (error: unknown) {
        this.logRejected('inventory.receive', productId, error);
        throw this.mapMutationError(error, productId, 'RECEIVE');
      }
    });
  }

  async adjustStock(input: AdjustStockCommand): Promise<InventoryBalance> {
    const productId = assertInventoryUuid(input.productId, 'productId');
    const delta = assertAdjustmentDelta(input.delta);
    const reason = normalizeLedgerReason(input.reason);
    if (reason === null) {
      throw new InventoryInvalidAdjustmentError(
        InventoryHttpMessage.REASON_REQUIRED,
      );
    }
    const idempotencyKey = this.requireIdempotencyKey(input.idempotencyKey);
    const actor = this.requireAdminActor(input.principal);
    const payloadHash = hashAdjustPayload({ productId, delta, reason });

    return this.transactions.run(async (ctx) => {
      const replay = await this.claimOrReplay({
        idempotencyKey,
        operation: InventoryCommandOperation.ADJUST,
        productId,
        payloadHash,
        ctx,
      });
      if (replay !== null) {
        return this.enrichReplayBalance(replay, productId, ctx);
      }

      try {
        const result = await this.inventory.adjustOnHand(
          {
            productId,
            delta,
            reason,
            referenceType: InventoryLedgerReferenceType.ADJUSTMENT,
            referenceId: idempotencyKey,
            actor,
            correlationId: idempotencyKey,
          },
          ctx,
        );

        await this.audit?.append(
          {
            action: AuditAction.INVENTORY_ADJUSTED,
            actorType: actor.type,
            actorId: actor.id,
            entityType: AuditEntityType.INVENTORY,
            entityId: productId,
            metadata: { changedFields: ['onHand'] },
          },
          ctx,
        );

        await this.idempotency.markCompleted(
          {
            idempotencyKey,
            onHandAfter: result.balance.onHand,
            reservedAfter: result.balance.reserved,
            ledgerId: result.ledger.id,
          },
          ctx,
        );

        this.logger.info(
          {
            module: 'inventory',
            operation: 'inventory.adjust.succeeded',
            productId,
            delta,
          },
          'Stock adjusted',
        );

        return result.balance;
      } catch (error: unknown) {
        this.logRejected('inventory.adjust', productId, error);
        throw this.mapMutationError(error, productId, 'ADJUST');
      }
    });
  }

  private requireIdempotencyKey(raw: string | undefined): string {
    if (raw === undefined || raw.trim() === '') {
      throw new ApplicationError(
        InventoryErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        InventoryHttpMessage.IDEMPOTENCY_KEY_REQUIRED,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!isInventoryUuid(raw.trim())) {
      throw new ApplicationError(
        InventoryErrorCode.IDEMPOTENCY_KEY_INVALID,
        InventoryHttpMessage.IDEMPOTENCY_KEY_INVALID,
        HttpStatus.BAD_REQUEST,
      );
    }
    return raw.trim().toLowerCase();
  }

  private requireAdminActor(principal: AuthenticatedPrincipal): InventoryActor {
    if (principal.subjectType !== AuthSubjectType.ADMIN) {
      throw new InventoryInvalidAdjustmentError(
        InventoryHttpMessage.ADMIN_REQUIRED,
      );
    }
    return assertLedgerActor({
      type: InventoryLedgerActorType.ADMIN,
      id: principal.subjectId,
    });
  }

  private async claimOrReplay(input: {
    idempotencyKey: string;
    operation: InventoryCommandOperation;
    productId: string;
    payloadHash: string;
    ctx: TransactionContext;
  }): Promise<InventoryBalance | null> {
    let existing = await this.idempotency.findByKeyForUpdate(
      input.idempotencyKey,
      input.ctx,
    );

    if (existing === null) {
      const inserted = await this.idempotency.insertPending(
        {
          idempotencyKey: input.idempotencyKey,
          operation: input.operation,
          productId: input.productId,
          payloadHash: input.payloadHash,
        },
        input.ctx,
      );
      if (inserted === null) {
        existing = await this.idempotency.findByKeyForUpdate(
          input.idempotencyKey,
          input.ctx,
        );
        if (existing === null) {
          throw new IdempotencyConflictError(
            InventoryHttpMessage.IDEMPOTENCY_CONFLICT,
            { idempotencyKey: input.idempotencyKey },
          );
        }
        return this.replayOrConflict(existing, input.payloadHash);
      }
      return null;
    }

    return this.replayOrConflict(existing, input.payloadHash);
  }

  private replayOrConflict(
    existing: InventoryCommandIdempotencyRecord,
    payloadHash: string,
  ): InventoryBalance {
    if (existing.payloadHash !== payloadHash) {
      throw new IdempotencyConflictError(
        InventoryHttpMessage.IDEMPOTENCY_CONFLICT,
        { idempotencyKey: existing.idempotencyKey },
      );
    }

    if (existing.status === InventoryCommandIdempotencyStatus.COMPLETED) {
      const snapshot = toBalanceFromIdempotency(existing);
      return {
        productId: snapshot.productId,
        onHand: snapshot.onHand,
        reserved: snapshot.reserved,
        available: snapshot.available,
        createdAt: existing.createdAt,
        updatedAt: existing.createdAt,
      };
    }

    throw new IdempotencyConflictError(
      InventoryHttpMessage.IDEMPOTENCY_CONFLICT,
      { idempotencyKey: existing.idempotencyKey, status: existing.status },
    );
  }

  private enrichReplayBalance(
    replay: InventoryBalance,
    productId: string,
    ctx: TransactionContext,
  ): Promise<InventoryBalance> {
    return this.inventory.getBalance(productId, ctx).then((current) => {
      if (current === null) {
        return replay;
      }
      return {
        ...replay,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
      };
    });
  }

  private mapMutationError(
    error: unknown,
    productId: string,
    operation: InventoryCommandOperation,
  ): unknown {
    if (error instanceof InventoryNotFoundError) {
      return new InventoryNotFoundError(InventoryHttpMessage.NOT_FOUND, {
        productId,
      });
    }
    if (error instanceof InventoryInvalidQuantityError) {
      return new InventoryInvalidQuantityError(
        InventoryHttpMessage.INVALID_QUANTITY,
      );
    }
    if (error instanceof InventoryInvalidAdjustmentError) {
      if (operation === InventoryCommandOperation.RECEIVE) {
        return new InventoryInvalidQuantityError(
          InventoryHttpMessage.INVALID_QUANTITY,
        );
      }
      return new InventoryInvalidAdjustmentError(
        InventoryHttpMessage.INVALID_ADJUSTMENT,
        { productId },
      );
    }
    return error;
  }

  private logRejected(
    operation: string,
    productId: string,
    error: unknown,
  ): void {
    if (
      error instanceof InventoryInvalidAdjustmentError ||
      error instanceof InventoryInvalidQuantityError ||
      error instanceof InventoryNotFoundError ||
      error instanceof IdempotencyConflictError
    ) {
      this.logger.info(
        {
          module: 'inventory',
          operation: 'inventory.mutation.rejected',
          mutation: operation,
          productId,
          errorCode: error instanceof ApplicationError ? error.code : 'UNKNOWN',
        },
        'Inventory mutation rejected',
      );
    }
  }
}

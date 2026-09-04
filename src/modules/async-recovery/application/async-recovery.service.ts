import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../../audit/domain/audit-event';
import { AuditLogService } from '../../audit/application/audit-log.service';
import {
  toPaginatedResponse,
  resolvePageRequest,
  type PaginatedResponse,
} from '../../../common/list';
import type {
  RecoveryProcessor,
  ReplayExecutionResult,
} from '../domain/async-recovery';
import { RECOVERY_PROCESSORS } from '../domain/async-recovery';
import { AsyncRecoveryRepository } from '../infrastructure/async-recovery.repository';
import type { AsyncFailureListQueryDto } from '../api/dto/async-failure-list-query.dto';
import {
  TransactionRunner,
  type TransactionContext,
} from '../../../infrastructure/database/transaction';

@Injectable()
export class AsyncRecoveryService {
  constructor(
    private readonly repository: AsyncRecoveryRepository,
    private readonly audit: AuditLogService,
    private readonly transactions: TransactionRunner,
    @Inject(RECOVERY_PROCESSORS)
    private readonly processors: readonly RecoveryProcessor[],
  ) {}

  async list(
    query: AsyncFailureListQueryDto,
  ): Promise<PaginatedResponse<unknown>> {
    const page = resolvePageRequest(query);
    const where: Prisma.AsyncFailureWhereInput = {
      ...(query.eventType ? { eventType: query.eventType } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.lifecycleState ? { lifecycleState: query.lifecycleState } : {}),
      ...(query.quarantined === true
        ? { quarantinedAt: { not: null } }
        : query.quarantined === false
          ? { quarantinedAt: null }
          : {}),
    };
    const [items, total] = await Promise.all([
      this.repository.list({
        where,
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.repository.count({ where }),
    ]);
    return toPaginatedResponse(items, page, total);
  }

  get(id: string): Promise<unknown> {
    return this.repository.find(id);
  }

  async replay(failureId: string, actorId: string): Promise<unknown> {
    const failure = await this.repository.find(failureId);
    if (!failure) throw new Error('ASYNC_FAILURE_NOT_FOUND');
    if (failure.quarantinedAt || failure.dismissedAt)
      throw new Error('ASYNC_FAILURE_REPLAY_BLOCKED');
    const processor = this.processors.find(
      (p) =>
        p.identity === failure.processorIdentity &&
        p.eventType === failure.eventType &&
        p.eventVersion === failure.eventVersion,
    );
    if (!processor || !processor.replaySafe) {
      await this.audit.append({
        action: AuditAction.ASYNC_REPLAY_REJECTED,
        actorType: AuditActorType.ADMIN,
        actorId,
        entityType: AuditEntityType.ASYNC_FAILURE,
        entityId: failure.id,
        metadata: { changedFields: ['unsupported_processor'] },
      });
      throw new Error('ASYNC_REPLAY_UNSUPPORTED');
    }
    try {
      return await this.transactions.run(async (tx: TransactionContext) => {
        const replay = await this.repository.createReplay(
          {
            failureId,
            deterministicJobId: `replay-${failureId}`,
            requestedBy: actorId,
          },
          tx,
        );
        await this.audit.append(
          {
            action: AuditAction.ASYNC_REPLAY_REQUESTED,
            actorType: AuditActorType.ADMIN,
            actorId,
            entityType: AuditEntityType.ASYNC_FAILURE,
            entityId: failure.id,
            metadata: { changedFields: ['replay_requested'] },
          },
          tx,
        );
        return replay;
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        return this.repository.findReplayByDeterministicJobId(
          `replay-${failureId}`,
        );
      throw error;
    }
  }

  async mutate(
    id: string,
    action: 'acknowledge' | 'quarantine' | 'unquarantine' | 'dismiss',
    actorId: string,
  ): Promise<unknown> {
    const data: Prisma.AsyncFailureUpdateInput =
      action === 'acknowledge'
        ? { acknowledgedAt: new Date(), lifecycleState: 'ACKNOWLEDGED' }
        : action === 'quarantine'
          ? { quarantinedAt: new Date() }
          : action === 'unquarantine'
            ? { quarantinedAt: null }
            : { dismissedAt: new Date(), lifecycleState: 'DISMISSED' };
    const actionMap = {
      acknowledge: AuditAction.ASYNC_FAILURE_ACKNOWLEDGED,
      quarantine: AuditAction.ASYNC_FAILURE_QUARANTINED,
      unquarantine: AuditAction.ASYNC_FAILURE_UNQUARANTINED,
      dismiss: AuditAction.ASYNC_FAILURE_DISMISSED,
    } as const;
    return this.transactions.run(async (tx: TransactionContext) => {
      const failure = await this.repository.find(id, tx);
      if (!failure) throw new Error('ASYNC_FAILURE_NOT_FOUND');
      const updated = await this.repository.updateFailure(id, data, tx);
      await this.audit.append(
        {
          action: actionMap[action],
          actorType: AuditActorType.ADMIN,
          actorId,
          entityType: AuditEntityType.ASYNC_FAILURE,
          entityId: id,
          metadata: { changedFields: [action] },
        },
        tx,
      );
      return updated;
    });
  }

  async recordReplayResult(
    replayId: string,
    result: ReplayExecutionResult,
  ): Promise<unknown> {
    return this.transactions.run(async (tx: TransactionContext) => {
      const replay = (await this.repository.findReplay(replayId)) as {
        failureId: string;
        status: string;
      } | null;
      if (!replay) throw new Error('ASYNC_REPLAY_NOT_FOUND');
      const successful = result.outcome === 'SUCCEEDED';
      const changed = await this.repository.completeReplay(
        replayId,
        {
          status: successful ? 'SUCCEEDED' : 'FAILED',
          completedAt: result.attemptedAt,
          failureReasonCode: successful ? null : result.failure.reasonCode,
          resultCategory: successful ? null : result.failure.category,
          processorIdentity: result.processorIdentity,
          releaseIdentity: result.releaseIdentity,
        },
        tx,
      );
      if (!changed) return null;
      const updated = await this.repository.findReplay(replayId, tx);
      await this.audit.append(
        {
          action: successful
            ? AuditAction.ASYNC_REPLAY_SUCCEEDED
            : AuditAction.ASYNC_REPLAY_FAILED,
          actorType: AuditActorType.SYSTEM,
          actorId: null,
          entityType: AuditEntityType.ASYNC_FAILURE,
          entityId: replay.failureId,
          metadata: { changedFields: ['replay_execution_result'] },
        },
        tx,
      );
      return updated;
    });
  }

  async beginReplayExecution(replayId: string): Promise<boolean> {
    return this.repository.markReplayRunning(replayId);
  }
}

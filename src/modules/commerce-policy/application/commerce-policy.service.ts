import { Injectable } from '@nestjs/common';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import { TransactionRunner } from '../../../infrastructure/database/transaction';
import { AuditLogService } from '../../audit/application/audit-log.service';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../../audit/domain/audit-event';
import {
  CommerceOverrideMode,
  type CommerceOverrideInput,
  type CommerceScheduleOverrideRecord,
  type CommerceSettingsInput,
  type CommerceSettingsRecord,
  isValidLocalDate,
  LOCAL_MINUTE_MAX,
  LOCAL_MINUTE_MIN,
  MINIMUM_ORDER_QUANTITY_MAX,
  MINIMUM_ORDER_QUANTITY_MIN,
} from '../domain/commerce-policy';
import {
  CommerceOverrideInvalidError,
  CommercePolicyInvalidSettingsError,
  CommercePolicyRevisionConflictError,
} from '../domain/commerce-policy-errors';
import {
  evaluateOrderAcceptance,
  previousLocalDate,
  toTehranLocalWallClock,
  type OrderAcceptanceEvaluationResult,
  type OrderAcceptanceLineQuantity,
} from '../domain/order-acceptance';
import {
  CommercePolicyRepository,
  type OverrideMutationResult,
  type PolicyMutationResult,
} from '../infrastructure/commerce-policy.repository';

@Injectable()
export class CommercePolicyService {
  constructor(
    private readonly repository: CommercePolicyRepository,
    private readonly logger: ApplicationLogger,
    private readonly transactions: TransactionRunner,
    private readonly audit: AuditLogService,
  ) {}

  getSettings(): Promise<CommerceSettingsRecord | null> {
    return this.repository.getSettings();
  }

  /**
   * COM-03 Order-acceptance contract.
   * Must join the caller's outer REPEATABLE READ transaction (no policy row locks).
   */
  async evaluateOrderAcceptance(
    normalizedLines: readonly OrderAcceptanceLineQuantity[],
    tx: TransactionContext,
  ): Promise<OrderAcceptanceEvaluationResult> {
    const evaluatedAt = await this.repository.readEvaluationInstant(tx);
    const { localDate } = toTehranLocalWallClock(evaluatedAt);
    const precedingDate = previousLocalDate(localDate);

    const settings = await this.repository.getSettings(tx);
    const overrides = await this.repository.findOverridesForLocalDates(
      [localDate, precedingDate],
      tx,
    );

    const byDate = new Map(
      overrides.map((override) => [override.localDate, override]),
    );

    return evaluateOrderAcceptance({
      settings,
      currentDateOverride: byDate.get(localDate) ?? null,
      previousDateOverride: byDate.get(precedingDate) ?? null,
      evaluatedAt,
      normalizedLines,
    });
  }
  listOverrides(
    from: string,
    to: string,
  ): Promise<CommerceScheduleOverrideRecord[]> {
    validateDate(from);
    validateDate(to);
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    if (end < start || end - start > 366 * 86_400_000)
      throw new CommerceOverrideInvalidError(
        'Override date range must be ordered and at most 366 days.',
      );
    return this.repository.listOverrides(from, to);
  }

  async initialize(
    input: CommerceSettingsInput,
    expectedRevision: number,
    actorId: string,
    tx?: TransactionContext,
  ): Promise<CommerceSettingsRecord> {
    if (expectedRevision !== 0)
      throw new CommercePolicyRevisionConflictError(
        (await this.repository.getSettings())?.revision ?? null,
      );
    validateSettings(input);
    const created = await this.transactions.runIn(tx, async (context) => {
      const value = await this.repository.initialize(input, actorId, context);
      await this.appendAudit(actorId, null, context);
      return value;
    });
    this.log('commerce.settings.created', actorId, 0, created.revision);
    return created;
  }

  async update(
    input: CommerceSettingsInput,
    expectedRevision: number,
    actorId: string,
    tx?: TransactionContext,
  ): Promise<PolicyMutationResult> {
    validateExpectedRevision(expectedRevision);
    validateSettings(input);
    const result = await this.transactions.runIn(tx, async (context) => {
      const value = await this.repository.updateSettings(
        input,
        expectedRevision,
        actorId,
        context,
      );
      if (value.changed) await this.appendAudit(actorId, null, context);
      return value;
    });
    if (result.changed)
      this.log(
        'commerce.settings.updated',
        actorId,
        expectedRevision,
        result.settings.revision,
      );
    return result;
  }

  async putOverride(
    localDate: string,
    input: CommerceOverrideInput,
    expectedRevision: number,
    actorId: string,
    tx?: TransactionContext,
  ): Promise<OverrideMutationResult> {
    validateExpectedRevision(expectedRevision);
    validateDate(localDate);
    validateOverride(input);
    const result = await this.transactions.runIn(tx, async (context) => {
      const value = await this.repository.putOverride(
        localDate,
        input,
        expectedRevision,
        actorId,
        context,
      );
      if (value.changed)
        await this.appendAudit(actorId, value.override.id, context);
      return value;
    });
    if (result.changed)
      this.log(
        `commerce.schedule_override.${result.action}`,
        actorId,
        expectedRevision,
        result.settings.revision,
        localDate,
      );
    return result;
  }

  async removeOverride(
    localDate: string,
    expectedRevision: number,
    actorId: string,
    tx?: TransactionContext,
  ): Promise<PolicyMutationResult> {
    validateExpectedRevision(expectedRevision);
    validateDate(localDate);
    const result = await this.transactions.runIn(tx, async (context) => {
      const value = await this.repository.removeOverride(
        localDate,
        expectedRevision,
        actorId,
        context,
      );
      await this.appendAudit(actorId, value.overrideId ?? null, context);
      return value;
    });
    this.log(
      'commerce.schedule_override.removed',
      actorId,
      expectedRevision,
      result.settings.revision,
      localDate,
    );
    return result;
  }

  private appendAudit(
    actorId: string,
    entityId: string | null,
    tx: TransactionContext,
  ): Promise<unknown> {
    return this.audit.append(
      {
        action: AuditAction.COMMERCE_POLICY_UPDATED,
        actorType: AuditActorType.ADMIN,
        actorId,
        entityType: AuditEntityType.COMMERCE_POLICY,
        entityId,
        metadata: undefined,
      },
      tx,
    );
  }

  private log(
    operation: string,
    actorId: string,
    previousRevision: number,
    revision: number,
    localDate?: string,
  ): void {
    this.logger.info(
      {
        module: 'commerce-policy',
        operation,
        actorId,
        previousRevision,
        revision,
        ...(localDate === undefined ? {} : { localDate }),
      },
      'Commerce policy changed',
    );
  }
}

function validateExpectedRevision(value: number): void {
  if (!Number.isInteger(value) || value < 1)
    throw new CommercePolicyInvalidSettingsError(
      'Expected revision must be a positive integer.',
    );
}
function validateDate(value: string): void {
  if (!isValidLocalDate(value))
    throw new CommerceOverrideInvalidError(
      'Local date must be a valid YYYY-MM-DD Tehran calendar date.',
    );
}
function validateSettings(input: CommerceSettingsInput): void {
  if (
    !validMinute(input.orderingOpensAtLocalMinute) ||
    !validMinute(input.orderingClosesAtLocalMinute) ||
    input.orderingOpensAtLocalMinute === input.orderingClosesAtLocalMinute
  )
    throw new CommercePolicyInvalidSettingsError(
      'Opening and closing times must be distinct minute-precision local times.',
    );
  if (
    !Number.isInteger(input.minimumOrderQuantity) ||
    input.minimumOrderQuantity < MINIMUM_ORDER_QUANTITY_MIN ||
    input.minimumOrderQuantity > MINIMUM_ORDER_QUANTITY_MAX
  )
    throw new CommercePolicyInvalidSettingsError(
      'Minimum order quantity is outside the supported range.',
    );
}
function validateOverride(input: CommerceOverrideInput): void {
  if (input.mode === CommerceOverrideMode.CLOSED) {
    if (input.opensAtLocalMinute !== null || input.closesAtLocalMinute !== null)
      throw new CommerceOverrideInvalidError(
        'CLOSED overrides must not include hours.',
      );
    return;
  }
  if (
    input.mode !== CommerceOverrideMode.SPECIAL_HOURS ||
    input.opensAtLocalMinute === null ||
    input.closesAtLocalMinute === null ||
    !validMinute(input.opensAtLocalMinute) ||
    !validMinute(input.closesAtLocalMinute) ||
    input.opensAtLocalMinute === input.closesAtLocalMinute
  )
    throw new CommerceOverrideInvalidError(
      'SPECIAL_HOURS requires distinct valid opening and closing times.',
    );
}
function validMinute(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= LOCAL_MINUTE_MIN &&
    value <= LOCAL_MINUTE_MAX
  );
}

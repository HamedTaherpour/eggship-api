import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import {
  resolvePrismaConnection,
  type PrismaConnection,
} from '../../../infrastructure/database/prisma/prisma-transaction-context';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import {
  COMMERCE_SETTINGS_SINGLETON_ID,
  type CommerceOverrideInput,
  type CommerceScheduleOverrideRecord,
  type CommerceSettingsInput,
  type CommerceSettingsRecord,
  type CommerceOverrideMode,
} from '../domain/commerce-policy';
import {
  CommerceOverrideNotFoundError,
  CommercePolicyNotInitializedError,
  CommercePolicyRevisionConflictError,
  OrderingPolicyUnavailableError,
} from '../domain/commerce-policy-errors';

export interface PolicyMutationResult {
  settings: CommerceSettingsRecord;
  changed: boolean;
}

export interface OverrideMutationResult extends PolicyMutationResult {
  override: CommerceScheduleOverrideRecord;
  action: 'created' | 'updated' | 'unchanged';
}

type SettingsRow = {
  orderingScheduleEnabled: boolean;
  orderingOpensAtLocalMinute: number;
  orderingClosesAtLocalMinute: number;
  minimumOrderQuantity: number;
  revision: number;
  createdByAdminId: string;
  updatedByAdminId: string;
  createdAt: Date;
  updatedAt: Date;
};

type OverrideRow = {
  id: string;
  localDate: Date;
  mode: CommerceOverrideMode;
  opensAtLocalMinute: number | null;
  closesAtLocalMinute: number | null;
  createdByAdminId: string;
  updatedByAdminId: string;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class CommercePolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: TransactionContext): PrismaConnection {
    return resolvePrismaConnection(this.prisma, tx);
  }

  async getSettings(
    tx?: TransactionContext,
  ): Promise<CommerceSettingsRecord | null> {
    const row = await this.db(tx).commerceSettings.findUnique({
      where: { id: COMMERCE_SETTINGS_SINGLETON_ID },
    });
    return row === null ? null : mapSettings(row);
  }

  async listOverrides(
    from: string,
    to: string,
    tx?: TransactionContext,
  ): Promise<CommerceScheduleOverrideRecord[]> {
    const rows = await this.db(tx).commerceScheduleOverride.findMany({
      where: { localDate: { gte: toDate(from), lte: toDate(to) } },
      orderBy: { localDate: 'asc' },
    });
    return rows.map(mapOverride);
  }

  /**
   * COM-03: stable PostgreSQL transaction instant for Order acceptance.
   * Uses CURRENT_TIMESTAMP (transaction_timestamp) — one value per attempt.
   */
  async readEvaluationInstant(tx: TransactionContext): Promise<Date> {
    const rows = await this.db(tx).$queryRaw<Array<{ evaluatedAt: Date }>>(
      Prisma.sql`SELECT CURRENT_TIMESTAMP AS "evaluatedAt"`,
    );
    const evaluatedAt = rows[0]?.evaluatedAt;
    if (!(evaluatedAt instanceof Date) || Number.isNaN(evaluatedAt.getTime())) {
      throw new OrderingPolicyUnavailableError();
    }
    return evaluatedAt;
  }

  /**
   * COM-03: lock-free override reads for the current and preceding local dates.
   */
  async findOverridesForLocalDates(
    localDates: readonly string[],
    tx: TransactionContext,
  ): Promise<CommerceScheduleOverrideRecord[]> {
    if (localDates.length === 0) {
      return [];
    }
    const uniqueDates = [...new Set(localDates)];
    const rows = await this.db(tx).commerceScheduleOverride.findMany({
      where: {
        localDate: { in: uniqueDates.map(toDate) },
      },
    });
    return rows.map(mapOverride);
  }

  async initialize(
    input: CommerceSettingsInput,
    actorId: string,
  ): Promise<CommerceSettingsRecord> {
    try {
      const created = await this.prisma.commerceSettings.create({
        data: {
          id: COMMERCE_SETTINGS_SINGLETON_ID,
          ...input,
          revision: 1,
          createdByAdminId: actorId,
          updatedByAdminId: actorId,
        },
      });
      return mapSettings(created);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        const current = await this.getSettings();
        throw new CommercePolicyRevisionConflictError(
          current?.revision ?? null,
        );
      }
      throw error;
    }
  }

  async updateSettings(
    input: CommerceSettingsInput,
    expectedRevision: number,
    actorId: string,
  ): Promise<PolicyMutationResult> {
    return this.prisma.$transaction(async (client) => {
      await lockSettings(client);
      const current = await client.commerceSettings.findUnique({
        where: { id: COMMERCE_SETTINGS_SINGLETON_ID },
      });
      assertExpectedRevision(current, expectedRevision);
      if (settingsEqual(current!, input))
        return { settings: mapSettings(current!), changed: false };

      const advanced = await client.commerceSettings.updateMany({
        where: {
          id: COMMERCE_SETTINGS_SINGLETON_ID,
          revision: expectedRevision,
        },
        data: {
          ...input,
          updatedByAdminId: actorId,
          revision: { increment: 1 },
        },
      });
      if (advanced.count !== 1) throw await revisionConflict(client);
      const updated = await client.commerceSettings.findUniqueOrThrow({
        where: { id: COMMERCE_SETTINGS_SINGLETON_ID },
      });
      return { settings: mapSettings(updated), changed: true };
    });
  }

  async putOverride(
    localDate: string,
    input: CommerceOverrideInput,
    expectedRevision: number,
    actorId: string,
  ): Promise<OverrideMutationResult> {
    return this.prisma.$transaction(async (client) => {
      await lockSettings(client);
      const settings = await client.commerceSettings.findUnique({
        where: { id: COMMERCE_SETTINGS_SINGLETON_ID },
      });
      assertExpectedRevision(settings, expectedRevision);
      const date = toDate(localDate);
      const existing = await client.commerceScheduleOverride.findUnique({
        where: { localDate: date },
      });
      if (existing !== null && overrideEqual(existing, input)) {
        return {
          settings: mapSettings(settings!),
          override: mapOverride(existing),
          changed: false,
          action: 'unchanged',
        };
      }

      const advanced = await client.commerceSettings.updateMany({
        where: {
          id: COMMERCE_SETTINGS_SINGLETON_ID,
          revision: expectedRevision,
        },
        data: { revision: { increment: 1 }, updatedByAdminId: actorId },
      });
      if (advanced.count !== 1) throw await revisionConflict(client);

      const override =
        existing === null
          ? await client.commerceScheduleOverride.create({
              data: {
                localDate: date,
                ...input,
                createdByAdminId: actorId,
                updatedByAdminId: actorId,
              },
            })
          : await client.commerceScheduleOverride.update({
              where: { id: existing.id },
              data: { ...input, updatedByAdminId: actorId },
            });
      const updatedSettings = await client.commerceSettings.findUniqueOrThrow({
        where: { id: COMMERCE_SETTINGS_SINGLETON_ID },
      });
      return {
        settings: mapSettings(updatedSettings),
        override: mapOverride(override),
        changed: true,
        action: existing === null ? 'created' : 'updated',
      };
    });
  }

  async removeOverride(
    localDate: string,
    expectedRevision: number,
    actorId: string,
  ): Promise<PolicyMutationResult> {
    return this.prisma.$transaction(async (client) => {
      await lockSettings(client);
      const settings = await client.commerceSettings.findUnique({
        where: { id: COMMERCE_SETTINGS_SINGLETON_ID },
      });
      assertExpectedRevision(settings, expectedRevision);
      const existing = await client.commerceScheduleOverride.findUnique({
        where: { localDate: toDate(localDate) },
      });
      if (existing === null) throw new CommerceOverrideNotFoundError();

      const advanced = await client.commerceSettings.updateMany({
        where: {
          id: COMMERCE_SETTINGS_SINGLETON_ID,
          revision: expectedRevision,
        },
        data: { revision: { increment: 1 }, updatedByAdminId: actorId },
      });
      if (advanced.count !== 1) throw await revisionConflict(client);
      await client.commerceScheduleOverride.delete({
        where: { id: existing.id },
      });
      const updated = await client.commerceSettings.findUniqueOrThrow({
        where: { id: COMMERCE_SETTINGS_SINGLETON_ID },
      });
      return { settings: mapSettings(updated), changed: true };
    });
  }
}

function assertExpectedRevision(
  row: SettingsRow | null,
  expectedRevision: number,
): void {
  if (row === null) throw new CommercePolicyNotInitializedError();
  if (row.revision !== expectedRevision)
    throw new CommercePolicyRevisionConflictError(row.revision);
}

async function revisionConflict(
  tx: Prisma.TransactionClient,
): Promise<CommercePolicyRevisionConflictError> {
  const current = await tx.commerceSettings.findUnique({
    where: { id: COMMERCE_SETTINGS_SINGLETON_ID },
    select: { revision: true },
  });
  return new CommercePolicyRevisionConflictError(current?.revision ?? null);
}

function settingsEqual(
  row: SettingsRow,
  input: CommerceSettingsInput,
): boolean {
  return (
    row.orderingScheduleEnabled === input.orderingScheduleEnabled &&
    row.orderingOpensAtLocalMinute === input.orderingOpensAtLocalMinute &&
    row.orderingClosesAtLocalMinute === input.orderingClosesAtLocalMinute &&
    row.minimumOrderQuantity === input.minimumOrderQuantity
  );
}
function overrideEqual(
  row: OverrideRow,
  input: CommerceOverrideInput,
): boolean {
  return (
    row.mode === input.mode &&
    row.opensAtLocalMinute === input.opensAtLocalMinute &&
    row.closesAtLocalMinute === input.closesAtLocalMinute
  );
}
function toDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
function mapSettings(row: SettingsRow): CommerceSettingsRecord {
  return { ...row };
}
function mapOverride(row: OverrideRow): CommerceScheduleOverrideRecord {
  return { ...row, localDate: row.localDate.toISOString().slice(0, 10) };
}
function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

async function lockSettings(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "CommerceSettings" WHERE "id" = ${COMMERCE_SETTINGS_SINGLETON_ID} FOR UPDATE`;
}

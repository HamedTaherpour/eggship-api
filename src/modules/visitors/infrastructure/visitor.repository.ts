import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type {
  ReferralAttributionRecord,
  CreateVisitorInput,
  VisitorRecord,
} from '../domain/visitor';
import {
  generateReferralCode,
  normalizeReferralCode,
} from '../domain/referral-code';
import {
  InvalidVisitorNameError,
  ReferralAttributionConflictError,
  ReferralCodeAlreadyExistsError,
  VisitorNotFoundError,
} from '../domain/visitor-errors';

type DbClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class VisitorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateVisitorInput): Promise<VisitorRecord> {
    const name = input.name.trim();
    if (name.length === 0 || name.length > 160)
      throw new InvalidVisitorNameError();
    const preferred =
      input.referralCode === undefined
        ? undefined
        : normalizeReferralCode(input.referralCode);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const created = await this.prisma.visitor.create({
          data: {
            name,
            referralCode: preferred ?? generateReferralCode(),
            isActive: input.isActive ?? true,
          },
        });
        return mapVisitor(created);
      } catch (error: unknown) {
        if (!isUniqueConstraintError(error)) throw error;
        if (preferred !== undefined) throw new ReferralCodeAlreadyExistsError();
      }
    }
    throw new ReferralCodeAlreadyExistsError();
  }

  async findByReferralCode(
    code: string,
    tx?: Prisma.TransactionClient,
  ): Promise<VisitorRecord | null> {
    const db: DbClient = tx ?? this.prisma;
    const found = await db.visitor.findUnique({
      where: { referralCode: normalizeReferralCode(code) },
    });
    return found === null ? null : mapVisitor(found);
  }

  /**
   * Locks the Visitor row for the duration of the caller's registration
   * transaction. Registration and lifecycle commands therefore serialize on
   * the same row: an inactive code is never attributed after deactivation
   * has committed, while a registration that acquired the lock first is a
   * valid earlier serial history.
   */
  async findByReferralCodeForUpdate(
    code: string,
    tx: Prisma.TransactionClient,
  ): Promise<VisitorRecord | null> {
    const rows = await tx.$queryRaw<VisitorRow[]>(Prisma.sql`
      SELECT "id", "name", "referralCode", "isActive", "createdAt", "updatedAt"
      FROM "Visitor"
      WHERE "referralCode" = ${normalizeReferralCode(code)}
      FOR UPDATE
    `);
    const found = rows[0];
    return found === undefined ? null : mapVisitor(found);
  }

  async deactivate(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<VisitorRecord> {
    const db: DbClient = tx ?? this.prisma;
    try {
      return mapVisitor(
        await db.visitor.update({
          where: { id },
          data: { isActive: false },
        }),
      );
    } catch (error: unknown) {
      if (isRecordNotFoundError(error)) throw new VisitorNotFoundError();
      throw error;
    }
  }

  async activate(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<VisitorRecord> {
    const db: DbClient = tx ?? this.prisma;
    try {
      return mapVisitor(
        await db.visitor.update({
          where: { id },
          data: { isActive: true },
        }),
      );
    } catch (error: unknown) {
      if (isRecordNotFoundError(error)) throw new VisitorNotFoundError();
      throw error;
    }
  }

  async createAttribution(
    input: {
      userId: string;
      visitorId: string;
      referralCode: string;
      attributedAt?: Date;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<ReferralAttributionRecord> {
    const db: DbClient = tx ?? this.prisma;
    try {
      const created = await db.referralAttribution.create({
        data: {
          userId: input.userId,
          source: 'VISITOR',
          visitorId: input.visitorId,
          referralCode: normalizeReferralCode(input.referralCode),
          attributedAt: input.attributedAt,
        },
      });
      return mapAttribution(created);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error))
        throw new ReferralAttributionConflictError();
      throw error;
    }
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function isRecordNotFoundError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
  );
}

type VisitorRow = {
  id: string;
  name: string;
  referralCode: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function mapVisitor(row: VisitorRow): VisitorRecord {
  return {
    id: row.id,
    name: row.name,
    referralCode: row.referralCode,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAttribution(row: {
  id: string;
  userId: string;
  source: 'VISITOR';
  visitorId: string;
  referralCode: string;
  attributedAt: Date;
}): ReferralAttributionRecord {
  return {
    id: row.id,
    userId: row.userId,
    source: row.source,
    visitorId: row.visitorId,
    referralCode: row.referralCode,
    attributedAt: row.attributedAt,
  };
}

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

function mapVisitor(row: {
  id: string;
  name: string;
  referralCode: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): VisitorRecord {
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

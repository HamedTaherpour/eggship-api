import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { resolvePrismaConnection } from '../../../infrastructure/database/prisma/prisma-transaction-context';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import {
  isCanonicalIranianPhone,
  InvalidIranianPhoneError,
} from '../domain/iranian-phone';
import type { CreateUserInput, UserRecord } from '../domain/user';

type PrismaUser = {
  id: string;
  phone: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type DbClient = PrismaService | Prisma.TransactionClient;

/**
 * User persistence. `findById` joins opaque TransactionContext for ORD-03A.
 * Auth completion still passes Prisma.TransactionClient to create/findByPhone
 * (AUTH-07 owns that transaction boundary).
 */
@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    input: CreateUserInput,
    tx?: Prisma.TransactionClient,
  ): Promise<UserRecord> {
    if (!isCanonicalIranianPhone(input.phone)) {
      throw new InvalidIranianPhoneError(
        'User phone must already be canonical E.164 (+989…).',
      );
    }

    const db: DbClient = tx ?? this.prisma;
    const created = await db.user.create({
      data: {
        phone: input.phone,
        isActive: input.isActive ?? true,
      },
    });

    return mapUser(created);
  }

  async findById(
    id: string,
    tx?: TransactionContext,
  ): Promise<UserRecord | null> {
    const db = resolvePrismaConnection(this.prisma, tx);
    const found = await db.user.findUnique({ where: { id } });
    return found === null ? null : mapUser(found);
  }

  async findByPhone(
    phone: string,
    tx?: Prisma.TransactionClient,
  ): Promise<UserRecord | null> {
    if (!isCanonicalIranianPhone(phone)) {
      return null;
    }

    const db: DbClient = tx ?? this.prisma;
    const found = await db.user.findUnique({ where: { phone } });
    return found === null ? null : mapUser(found);
  }
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function mapUser(row: PrismaUser): UserRecord {
  return {
    id: row.id,
    phone: row.phone,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

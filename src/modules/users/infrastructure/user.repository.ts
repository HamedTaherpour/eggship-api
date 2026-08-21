import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
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
    tx?: Prisma.TransactionClient,
  ): Promise<UserRecord | null> {
    const db: DbClient = tx ?? this.prisma;
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

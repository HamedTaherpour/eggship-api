import { Injectable } from '@nestjs/common';
import {
  criticalAdminRole,
  isAdminRole,
  type AdminRole,
} from '../../../common/authz/admin-role';
import { Prisma } from '../../../generated/prisma/client';
import { AdminRole as PrismaAdminRole } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import {
  resolvePrismaConnection,
  type PrismaConnection,
} from '../../../infrastructure/database/prisma/prisma-transaction-context';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import {
  InvalidAdminEmailError,
  normalizeAdminEmail,
} from '../domain/admin-email';
import {
  AdminEmailAlreadyExistsError,
  UnknownAdminRoleError,
} from '../domain/admin-errors';
import type {
  AdminAuthorizationState,
  AdminLoginCredential,
  AdminRecord,
  CreateAdminInput,
} from '../domain/admin';

type PrismaAdmin = {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Narrow persistence boundary for Admin identity. Prisma types stay here.
 *
 * Both entry points canonicalize the email themselves rather than requiring a
 * pre-normalized argument, which is a deliberate difference from
 * `UserRepository.findByPhone`. Email is the login identifier, and a caller that
 * forgot to normalize must not silently observe "no such admin" for a valid
 * address typed with different capitalization.
 */
@Injectable()
export class AdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists a new admin. The database unique index on the canonical email is
   * the authoritative guard: concurrent creations of the same identity cannot
   * both commit, and the loser surfaces as `AdminEmailAlreadyExistsError`
   * instead of a Prisma error code leaking into the application layer.
   */
  async create(
    input: CreateAdminInput,
    tx?: TransactionContext,
  ): Promise<AdminRecord> {
    const email = normalizeAdminEmail(input.email);

    try {
      const created = await this.db(tx).admin.create({
        data: {
          email,
          passwordHash: input.passwordHash,
          role: input.role,
          isActive: input.isActive ?? true,
        },
      });
      return mapAdmin(created);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new AdminEmailAlreadyExistsError();
      }
      throw error;
    }
  }

  private db(tx: TransactionContext | undefined): PrismaConnection {
    return resolvePrismaConnection(this.prisma, tx);
  }

  /** Returns null when the input cannot be canonicalized at all. */
  async findByEmail(email: string): Promise<AdminRecord | null> {
    let canonical: string;
    try {
      canonical = normalizeAdminEmail(email);
    } catch (error: unknown) {
      if (error instanceof InvalidAdminEmailError) {
        return null;
      }
      throw error;
    }

    const found = await this.prisma.admin.findUnique({
      where: { email: canonical },
    });
    return found === null ? null : mapAdmin(found);
  }

  async findById(id: string): Promise<AdminRecord | null> {
    const found = await this.prisma.admin.findUnique({ where: { id } });
    return found === null ? null : mapAdmin(found);
  }

  async findByIdInTransaction(
    id: string,
    tx: TransactionContext,
  ): Promise<AdminRecord | null> {
    const found = await resolvePrismaConnection(
      this.prisma,
      tx,
    ).admin.findUnique({
      where: { id },
    });
    return found === null ? null : mapAdmin(found);
  }

  async list(input: {
    page: number;
    pageSize: number;
    search?: string;
    role?: string;
    isActive?: boolean;
    sortBy: 'email' | 'createdAt' | 'updatedAt';
    sortOrder: 'asc' | 'desc';
  }): Promise<{ items: AdminRecord[]; total: number }> {
    const where: Prisma.AdminWhereInput = {};
    if (input.search !== undefined) {
      where.email = { contains: input.search.trim().toLowerCase() };
    }
    if (input.role !== undefined) where.role = input.role as PrismaAdminRole;
    if (input.isActive !== undefined) where.isActive = input.isActive;
    const skip = (input.page - 1) * input.pageSize;
    const orderBy = {
      [input.sortBy]: input.sortOrder,
    } as Prisma.AdminOrderByWithRelationInput;
    const db = this.prisma;
    const [total, rows] = await db.$transaction([
      db.admin.count({ where }),
      db.admin.findMany({
        where,
        orderBy: [orderBy, { id: input.sortOrder }],
        skip,
        take: input.pageSize,
      }),
    ]);
    return { items: rows.map(mapAdmin), total };
  }

  async lockManagementScope(tx: TransactionContext): Promise<void> {
    const db = resolvePrismaConnection(this.prisma, tx);
    await db.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('eggship.admin-management', 0))`,
    );
    await db.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM "Admin" WHERE role = ${criticalAdminRole()} AND "isActive" = true FOR UPDATE`,
    );
  }

  async countActiveSuperAdmins(tx: TransactionContext): Promise<number> {
    const db = resolvePrismaConnection(this.prisma, tx);
    const rows = await db.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`SELECT COUNT(*)::bigint AS count FROM "Admin" WHERE role = ${criticalAdminRole()} AND "isActive" = true`,
    );
    return Number(rows[0]?.count ?? 0n);
  }

  async updateRole(
    id: string,
    role: AdminRole,
    tx: TransactionContext,
  ): Promise<AdminRecord> {
    return mapAdmin(
      await resolvePrismaConnection(this.prisma, tx).admin.update({
        where: { id },
        data: { role },
      }),
    );
  }

  async updateActive(
    id: string,
    isActive: boolean,
    tx: TransactionContext,
  ): Promise<AdminRecord> {
    return mapAdmin(
      await resolvePrismaConnection(this.prisma, tx).admin.update({
        where: { id },
        data: { isActive },
      }),
    );
  }

  /**
   * Login-only credential read. Selects `passwordHash` and activation, never
   * the email (the caller already has the identifier it looked up).
   */
  async findLoginCredentialByEmail(
    email: string,
  ): Promise<AdminLoginCredential | null> {
    let canonical: string;
    try {
      canonical = normalizeAdminEmail(email);
    } catch (error: unknown) {
      if (error instanceof InvalidAdminEmailError) {
        return null;
      }
      throw error;
    }

    const found = await this.prisma.admin.findUnique({
      where: { email: canonical },
      select: { id: true, passwordHash: true, isActive: true },
    });
    return found === null
      ? null
      : {
          id: found.id,
          passwordHash: found.passwordHash,
          isActive: found.isActive,
        };
  }

  /**
   * Reads only the state an authorization decision needs. The email is
   * deliberately not selected, so the authorization path never loads operator
   * PII, and `role` is returned unnarrowed for `AuthorizationService` to judge.
   */
  async findAuthorizationState(
    id: string,
  ): Promise<AdminAuthorizationState | null> {
    const found = await this.prisma.admin.findUnique({
      where: { id },
      select: { id: true, role: true, isActive: true },
    });
    return found === null
      ? null
      : { id: found.id, role: found.role, isActive: found.isActive };
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function mapAdmin(row: PrismaAdmin): AdminRecord {
  if (!isAdminRole(row.role)) {
    // Only reachable if the database enum and the code-defined roles drift.
    throw new UnknownAdminRoleError();
  }
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

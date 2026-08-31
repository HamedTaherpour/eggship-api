import { Injectable } from '@nestjs/common';
import { isAdminRole } from '../../../common/authz/admin-role';
import { Prisma } from '../../../generated/prisma/client';
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

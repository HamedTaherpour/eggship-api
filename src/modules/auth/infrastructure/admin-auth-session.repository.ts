import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import {
  resolvePrismaConnection,
  type PrismaConnection,
} from '../../../infrastructure/database/prisma/prisma-transaction-context';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import type {
  AdminAuthRefreshTokenConsumptionRecord,
  AdminAuthSessionRecord,
  CreateAdminAuthSessionInput,
  RotateAdminRefreshTokenHashInput,
} from '../domain/admin-auth-session';
import {
  assertRefreshTokenHash,
  isRefreshTokenHashShape,
} from '../domain/refresh-token-hash';

type PrismaAdminAuthSession = {
  id: string;
  adminId: string;
  refreshTokenHash: string;
  tokenFamilyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type PrismaAdminConsumption = {
  id: string;
  sessionId: string;
  tokenFamilyId: string;
  refreshTokenHash: string;
  consumedAt: Date;
  expiresAt: Date;
};

@Injectable()
export class AdminAuthSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(
    input: CreateAdminAuthSessionInput,
    tx?: TransactionContext,
  ): Promise<AdminAuthSessionRecord> {
    assertRefreshTokenHash(input.refreshTokenHash);

    const db: PrismaConnection = resolvePrismaConnection(this.prisma, tx);
    const created = await db.adminAuthSession.create({
      data: {
        ...(input.id === undefined ? {} : { id: input.id }),
        adminId: input.adminId,
        refreshTokenHash: input.refreshTokenHash,
        tokenFamilyId: input.tokenFamilyId,
        expiresAt: input.expiresAt,
        lastUsedAt: input.lastUsedAt ?? null,
      },
    });

    return mapSession(created);
  }

  async findSessionById(
    id: string,
    tx?: TransactionContext,
  ): Promise<AdminAuthSessionRecord | null> {
    const found = await resolvePrismaConnection(
      this.prisma,
      tx,
    ).adminAuthSession.findUnique({
      where: { id },
    });
    return found === null ? null : mapSession(found);
  }

  async findSessionByRefreshTokenHash(
    refreshTokenHash: string,
  ): Promise<AdminAuthSessionRecord | null> {
    if (!isRefreshTokenHashShape(refreshTokenHash)) {
      return null;
    }

    const found = await this.prisma.adminAuthSession.findUnique({
      where: { refreshTokenHash },
    });
    return found === null ? null : mapSession(found);
  }

  async listActiveSessionsForAdmin(
    adminId: string,
    now: Date,
  ): Promise<AdminAuthSessionRecord[]> {
    const rows = await this.prisma.adminAuthSession.findMany({
      where: {
        adminId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map(mapSession);
  }

  async revokeSession(
    sessionId: string,
    revokedAt: Date,
    tx?: TransactionContext,
  ): Promise<boolean> {
    const result = await resolvePrismaConnection(
      this.prisma,
      tx,
    ).adminAuthSession.updateMany({
      where: {
        id: sessionId,
        revokedAt: null,
      },
      data: { revokedAt },
    });

    return result.count === 1;
  }

  async revokeAllAdminSessions(
    adminId: string,
    revokedAt: Date,
    tx?: TransactionContext,
  ): Promise<number> {
    const result = await resolvePrismaConnection(
      this.prisma,
      tx,
    ).adminAuthSession.updateMany({
      where: {
        adminId,
        revokedAt: null,
      },
      data: { revokedAt },
    });

    return result.count;
  }

  async revokeSessionsByTokenFamily(
    tokenFamilyId: string,
    revokedAt: Date,
    tx?: TransactionContext,
  ): Promise<number> {
    const result = await resolvePrismaConnection(
      this.prisma,
      tx,
    ).adminAuthSession.updateMany({
      where: {
        tokenFamilyId,
        revokedAt: null,
      },
      data: { revokedAt },
    });

    return result.count;
  }

  async findConsumedRefreshTokenByHash(
    refreshTokenHash: string,
    tx?: TransactionContext,
  ): Promise<AdminAuthRefreshTokenConsumptionRecord | null> {
    if (!isRefreshTokenHashShape(refreshTokenHash)) {
      return null;
    }

    const found = await resolvePrismaConnection(
      this.prisma,
      tx,
    ).adminAuthRefreshTokenConsumption.findUnique({
      where: { refreshTokenHash },
    });
    return found === null ? null : mapConsumption(found);
  }

  /**
   * Atomic Admin refresh-token rotation.
   * Succeeds only when the session is active and still holds `currentRefreshTokenHash`.
   * Records the previous digest in Admin consumption history in the same transaction.
   */
  async rotateRefreshTokenHash(
    input: RotateAdminRefreshTokenHashInput,
  ): Promise<AdminAuthSessionRecord | null> {
    assertRefreshTokenHash(input.currentRefreshTokenHash);
    assertRefreshTokenHash(input.newRefreshTokenHash);

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.adminAuthSession.updateMany({
        where: {
          id: input.sessionId,
          refreshTokenHash: input.currentRefreshTokenHash,
          revokedAt: null,
          expiresAt: { gt: input.now },
        },
        data: {
          refreshTokenHash: input.newRefreshTokenHash,
          lastUsedAt: input.now,
        },
      });

      if (result.count === 0) {
        return null;
      }

      await tx.adminAuthRefreshTokenConsumption.create({
        data: {
          sessionId: input.sessionId,
          tokenFamilyId: input.tokenFamilyId,
          refreshTokenHash: input.currentRefreshTokenHash,
          consumedAt: input.now,
          expiresAt: input.consumptionExpiresAt,
        },
      });

      const updated = await tx.adminAuthSession.findUnique({
        where: { id: input.sessionId },
      });
      return updated === null ? null : mapSession(updated);
    });
  }
}

function mapSession(row: PrismaAdminAuthSession): AdminAuthSessionRecord {
  return {
    id: row.id,
    adminId: row.adminId,
    refreshTokenHash: row.refreshTokenHash,
    tokenFamilyId: row.tokenFamilyId,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapConsumption(
  row: PrismaAdminConsumption,
): AdminAuthRefreshTokenConsumptionRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    tokenFamilyId: row.tokenFamilyId,
    refreshTokenHash: row.refreshTokenHash,
    consumedAt: row.consumedAt,
    expiresAt: row.expiresAt,
  };
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type {
  AuthRefreshTokenConsumptionRecord,
  AuthSessionRecord,
  CreateAuthSessionInput,
  RotateRefreshTokenHashInput,
} from '../domain/auth-session';
import {
  assertRefreshTokenHash,
  isRefreshTokenHashShape,
} from '../domain/refresh-token-hash';

type PrismaAuthSession = {
  id: string;
  userId: string;
  refreshTokenHash: string;
  tokenFamilyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type PrismaConsumption = {
  id: string;
  sessionId: string;
  tokenFamilyId: string;
  refreshTokenHash: string;
  consumedAt: Date;
  expiresAt: Date;
};

@Injectable()
export class AuthSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(
    input: CreateAuthSessionInput,
    tx?: Prisma.TransactionClient,
  ): Promise<AuthSessionRecord> {
    assertRefreshTokenHash(input.refreshTokenHash);

    const db = tx ?? this.prisma;
    const created = await db.authSession.create({
      data: {
        ...(input.id === undefined ? {} : { id: input.id }),
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        tokenFamilyId: input.tokenFamilyId,
        expiresAt: input.expiresAt,
        lastUsedAt: input.lastUsedAt ?? null,
      },
    });

    return mapSession(created);
  }

  async findSessionById(id: string): Promise<AuthSessionRecord | null> {
    const found = await this.prisma.authSession.findUnique({ where: { id } });
    return found === null ? null : mapSession(found);
  }

  async findSessionByRefreshTokenHash(
    refreshTokenHash: string,
  ): Promise<AuthSessionRecord | null> {
    if (!isRefreshTokenHashShape(refreshTokenHash)) {
      return null;
    }

    const found = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash },
    });
    return found === null ? null : mapSession(found);
  }

  /**
   * Active = unrevoked and not expired at `now`.
   */
  async listActiveSessionsForUser(
    userId: string,
    now: Date,
  ): Promise<AuthSessionRecord[]> {
    const rows = await this.prisma.authSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map(mapSession);
  }

  /**
   * Conditional revoke: only unrevoked sessions transition.
   * Returns true when this call performed the revocation.
   */
  async revokeSession(sessionId: string, revokedAt: Date): Promise<boolean> {
    const result = await this.prisma.authSession.updateMany({
      where: {
        id: sessionId,
        revokedAt: null,
      },
      data: { revokedAt },
    });

    return result.count === 1;
  }

  /**
   * Conditionally revokes all currently unrevoked sessions for a user.
   * Returns the number of sessions transitioned to revoked.
   */
  async revokeAllUserSessions(
    userId: string,
    revokedAt: Date,
  ): Promise<number> {
    const result = await this.prisma.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: { revokedAt },
    });

    return result.count;
  }

  /**
   * Revokes every unrevoked session sharing a token family (reuse response).
   * Does not revoke sessions belonging to other families/users.
   */
  async revokeSessionsByTokenFamily(
    tokenFamilyId: string,
    revokedAt: Date,
  ): Promise<number> {
    const result = await this.prisma.authSession.updateMany({
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
  ): Promise<AuthRefreshTokenConsumptionRecord | null> {
    if (!isRefreshTokenHashShape(refreshTokenHash)) {
      return null;
    }

    const found = await this.prisma.authRefreshTokenConsumption.findUnique({
      where: { refreshTokenHash },
    });
    return found === null ? null : mapConsumption(found);
  }

  /**
   * Atomic refresh-token rotation for AUTH-04.
   * Succeeds only when the session is active and still holds `currentRefreshTokenHash`.
   * Records the previous digest in consumption history inside the same transaction.
   */
  async rotateRefreshTokenHash(
    input: RotateRefreshTokenHashInput,
  ): Promise<AuthSessionRecord | null> {
    assertRefreshTokenHash(input.currentRefreshTokenHash);
    assertRefreshTokenHash(input.newRefreshTokenHash);

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.authSession.updateMany({
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

      await tx.authRefreshTokenConsumption.create({
        data: {
          sessionId: input.sessionId,
          tokenFamilyId: input.tokenFamilyId,
          refreshTokenHash: input.currentRefreshTokenHash,
          consumedAt: input.now,
          expiresAt: input.consumptionExpiresAt,
        },
      });

      const updated = await tx.authSession.findUnique({
        where: { id: input.sessionId },
      });
      return updated === null ? null : mapSession(updated);
    });
  }
}

function mapSession(row: PrismaAuthSession): AuthSessionRecord {
  return {
    id: row.id,
    userId: row.userId,
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
  row: PrismaConsumption,
): AuthRefreshTokenConsumptionRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    tokenFamilyId: row.tokenFamilyId,
    refreshTokenHash: row.refreshTokenHash,
    consumedAt: row.consumedAt,
    expiresAt: row.expiresAt,
  };
}

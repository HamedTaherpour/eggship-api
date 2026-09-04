import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import {
  PushInstallationActiveConflictError,
  PushInstallationOwnershipError,
  type PushInstallationRecord,
  type RegisterPushInstallationInput,
} from '../domain/push-installation';

@Injectable()
export class PushInstallationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async register(
    userId: string,
    input: RegisterPushInstallationInput,
  ): Promise<PushInstallationRecord> {
    // Registration is deliberately bounded, but the bound must cover the
    // supported installation stampede without leaking a transient P2034.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        return await this.registerOnce(userId, input);
      } catch (error: unknown) {
        if (!isSerializationConflict(error) || attempt === 7) throw error;
      }
    }
    throw new Error('Unreachable registration retry state.');
  }

  private async registerOnce(
    userId: string,
    input: RegisterPushInstallationInput,
  ): Promise<PushInstallationRecord> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.pushInstallation.findUnique({
            where: { installationId: input.installationId },
          });
          if (
            existing !== null &&
            existing.userId !== userId &&
            existing.status === 'ACTIVE'
          )
            throw new PushInstallationActiveConflictError();
          const row =
            existing === null
              ? await tx.pushInstallation.create({
                  data: {
                    userId,
                    installationId: input.installationId,
                    providerToken: input.providerToken,
                    permissionGranted: input.permissionGranted,
                  },
                })
              : await tx.pushInstallation.update({
                  where: { id: existing.id },
                  data: {
                    userId,
                    providerToken: input.providerToken,
                    permissionGranted: input.permissionGranted,
                    status: 'ACTIVE',
                    revokedAt: null,
                  },
                });
          return mapInstallation(row);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (error instanceof PushInstallationActiveConflictError) throw error;
      if (isUnique(error)) {
        const owner = await this.prisma.pushInstallation.findUnique({
          where: { providerToken: input.providerToken },
        });
        if (
          owner === null ||
          owner.userId !== userId ||
          owner.installationId !== input.installationId
        )
          throw new PushInstallationActiveConflictError();
        return mapInstallation(
          await this.prisma.pushInstallation.update({
            where: { id: owner.id },
            data: {
              permissionGranted: input.permissionGranted,
              status: 'ACTIVE',
              revokedAt: null,
            },
          }),
        );
      }
      throw error;
    }
  }

  async revokeOwned(userId: string, installationId: string): Promise<void> {
    const result = await this.prisma.pushInstallation.updateMany({
      where: { userId, installationId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    if (result.count === 0) {
      const found = await this.prisma.pushInstallation.findUnique({
        where: { installationId },
        select: { userId: true },
      });
      if (found !== null && found.userId !== userId)
        throw new PushInstallationOwnershipError();
    }
  }

  async revokeAllOwned(userId: string): Promise<number> {
    const result = await this.prisma.pushInstallation.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    return result.count;
  }

  async findEligible(userId: string): Promise<PushInstallationRecord[]> {
    const rows = await this.prisma.pushInstallation.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        permissionGranted: true,
        user: { isActive: true },
      },
    });
    return rows.map(mapInstallation);
  }

  async invalidate(id: string): Promise<void> {
    await this.prisma.pushInstallation.updateMany({
      where: { id, status: 'ACTIVE' },
      data: { status: 'INVALIDATED', revokedAt: new Date() },
    });
  }
}

function isUnique(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function isSerializationConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  );
}

function mapInstallation(row: {
  id: string;
  userId: string;
  installationId: string;
  providerToken: string;
  permissionGranted: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
}): PushInstallationRecord {
  return {
    id: row.id,
    userId: row.userId,
    installationId: row.installationId,
    providerToken: row.providerToken,
    permissionGranted: row.permissionGranted,
    status: row.status as PushInstallationRecord['status'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revokedAt: row.revokedAt,
  };
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { randomUUID } from 'node:crypto';
import type {
  CreateNotificationDeliveryInput,
  NotificationDeliveryRecord,
} from '../domain/notification-delivery';

@Injectable()
export class NotificationDeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Upsert makes duplicate outbox publication converge on one logical row. */
  async createIfAbsent(
    input: CreateNotificationDeliveryInput,
  ): Promise<NotificationDeliveryRecord> {
    let row;
    try {
      row = await this.prisma.notificationDelivery.upsert({
        where: { notificationId_installationId_channel: input },
        create: input,
        update: {},
      });
    } catch (error: unknown) {
      if (!isUnique(error)) throw error;
      row = await this.prisma.notificationDelivery.findUniqueOrThrow({
        where: { notificationId_installationId_channel: input },
      });
    }
    return row;
  }

  async transitionTo(
    state: NotificationDeliveryRecord['state'],
    id: string,
    failureCode?: NotificationDeliveryRecord['failureCode'],
  ): Promise<boolean> {
    const result = await this.prisma.notificationDelivery.updateMany({
      where: { id, state: { in: ['PENDING', 'SENDING'] } },
      data: { state, failureCode: failureCode ?? null },
    });
    return result.count === 1;
  }

  async materializeOnce(notificationId: string, userId: string): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            const marker = await tx.notification.updateMany({
              where: { id: notificationId, pushDeliveriesMaterializedAt: null },
              data: { pushDeliveriesMaterializedAt: new Date() },
            });
            if (marker.count === 0) return;
            const installations = await tx.pushInstallation.findMany({
              where: {
                userId,
                status: 'ACTIVE',
                permissionGranted: true,
                user: { isActive: true },
              },
              select: { id: true },
            });
            for (const installation of installations) {
              await tx.notificationDelivery.upsert({
                where: {
                  notificationId_installationId_channel: {
                    notificationId,
                    installationId: installation.id,
                    channel: 'WEB_PUSH',
                  },
                },
                create: {
                  notificationId,
                  installationId: installation.id,
                  channel: 'WEB_PUSH',
                },
                update: {},
              });
            }
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return;
      } catch (error: unknown) {
        if (!isSerializationConflict(error) || attempt === 7) throw error;
      }
    }
  }

  async findClaimable(notificationId: string): Promise<
    Array<
      NotificationDeliveryRecord & {
        providerToken: string;
        userIsActive: boolean;
        permissionGranted: boolean;
        installationStatus: string;
      }
    >
  > {
    return this.prisma.notificationDelivery
      .findMany({
        where: {
          notificationId,
          channel: 'WEB_PUSH',
          OR: [
            { state: 'PENDING' },
            {
              state: 'FAILED',
              failureCode: { in: ['TRANSIENT', 'RATE_LIMITED'] },
            },
            { state: 'SENDING', leaseExpiresAt: { lte: new Date() } },
          ],
        },
        include: {
          installation: {
            select: {
              providerToken: true,
              status: true,
              permissionGranted: true,
              user: { select: { isActive: true } },
            },
          },
        },
        orderBy: { id: 'asc' },
      })
      .then((rows) =>
        rows.map((row) => ({
          ...row,
          providerToken: row.installation.providerToken,
          installationStatus: row.installation.status,
          permissionGranted: row.installation.permissionGranted,
          userIsActive: row.installation.user.isActive,
        })),
      );
  }

  async claim(
    id: string,
    leaseSeconds = 60,
  ): Promise<{ claimToken: string; attemptCount: number } | null> {
    const claimToken = randomUUID();
    const rows = await this.prisma.$queryRaw<
      Array<{ attemptCount: number }>
    >(Prisma.sql`
      UPDATE "NotificationDelivery"
      SET "state" = 'SENDING', "claimToken" = CAST(${claimToken} AS UUID),
          "claimedAt" = CURRENT_TIMESTAMP,
          "leaseExpiresAt" = CURRENT_TIMESTAMP + (${leaseSeconds} * INTERVAL '1 second'),
          "attemptCount" = "attemptCount" + 1, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = CAST(${id} AS UUID)
        AND ("state" = 'PENDING' OR ("state" = 'FAILED' AND "failureCode" IN ('TRANSIENT','RATE_LIMITED'))
          OR ("state" = 'SENDING' AND "leaseExpiresAt" <= CURRENT_TIMESTAMP))
        AND EXISTS (
          SELECT 1 FROM "PushInstallation" installation
          JOIN "User" app_user ON app_user."id" = installation."userId"
          WHERE installation."id" = "NotificationDelivery"."installationId"
            AND installation."status" = 'ACTIVE'
            AND installation."permissionGranted" = TRUE
            AND app_user."isActive" = TRUE
        )
      RETURNING "attemptCount"
    `);
    return rows[0] ? { claimToken, attemptCount: rows[0].attemptCount } : null;
  }

  async isEligible(installationId: string): Promise<boolean> {
    const row = await this.prisma.pushInstallation.findFirst({
      where: {
        id: installationId,
        status: 'ACTIVE',
        permissionGranted: true,
        user: { isActive: true },
      },
      select: { id: true },
    });
    return row !== null;
  }

  async complete(
    id: string,
    claimToken: string,
    state: NotificationDeliveryRecord['state'],
    failureCode?: NotificationDeliveryRecord['failureCode'],
  ): Promise<boolean> {
    const result = await this.prisma.notificationDelivery.updateMany({
      where: { id, state: 'SENDING', claimToken },
      data: {
        state,
        failureCode: failureCode ?? null,
        claimToken: null,
        claimedAt: null,
        leaseExpiresAt: null,
      },
    });
    return result.count === 1;
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

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
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
}

function isUnique(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

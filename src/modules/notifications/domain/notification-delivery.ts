import type {
  NotificationChannel,
  NotificationDeliveryFailureCode,
  NotificationDeliveryState,
} from '../../../generated/prisma/client';

export type {
  NotificationChannel,
  NotificationDeliveryFailureCode,
  NotificationDeliveryState,
};

export interface NotificationDeliveryRecord {
  id: string;
  notificationId: string;
  installationId: string;
  channel: NotificationChannel;
  state: NotificationDeliveryState;
  failureCode: NotificationDeliveryFailureCode | null;
  attemptCount: number;
  claimToken: string | null;
  claimedAt: Date | null;
  leaseExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNotificationDeliveryInput {
  notificationId: string;
  installationId: string;
  channel: NotificationChannel;
}

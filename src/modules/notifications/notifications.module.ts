import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationRepository } from './infrastructure/notification.repository';
import { NotificationInboxController } from './api/notification-inbox.controller';
import { NotificationInboxService } from './application/notification-inbox.service';
import { OrderStatusNotificationService } from './application/order-status-notification.service';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [PrismaModule, AuthModule, OutboxModule],
  controllers: [NotificationInboxController],
  providers: [
    NotificationRepository,
    NotificationInboxService,
    OrderStatusNotificationService,
  ],
  exports: [NotificationRepository, OrderStatusNotificationService],
})
export class NotificationsModule {}

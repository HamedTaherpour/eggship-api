import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationRepository } from './infrastructure/notification.repository';
import { NotificationInboxController } from './api/notification-inbox.controller';
import { NotificationInboxService } from './application/notification-inbox.service';
import { OrderStatusNotificationService } from './application/order-status-notification.service';
import { OutboxModule } from '../outbox/outbox.module';
import { PushInstallationRepository } from './infrastructure/push-installation.repository';
import { PushInstallationService } from './application/push-installation.service';
import { PushInstallationController } from './api/push-installation.controller';
import { NotificationDeliveryRepository } from './infrastructure/notification-delivery.repository';

@Module({
  imports: [PrismaModule, forwardRef(() => AuthModule), OutboxModule],
  controllers: [NotificationInboxController, PushInstallationController],
  providers: [
    NotificationRepository,
    NotificationInboxService,
    OrderStatusNotificationService,
    PushInstallationRepository,
    PushInstallationService,
    NotificationDeliveryRepository,
  ],
  exports: [
    NotificationRepository,
    OrderStatusNotificationService,
    PushInstallationService,
    NotificationDeliveryRepository,
  ],
})
export class NotificationsModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationRepository } from './infrastructure/notification.repository';
import { NotificationInboxController } from './api/notification-inbox.controller';
import { NotificationInboxService } from './application/notification-inbox.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [NotificationInboxController],
  providers: [NotificationRepository, NotificationInboxService],
  exports: [NotificationRepository],
})
export class NotificationsModule {}

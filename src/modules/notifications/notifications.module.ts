import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { NotificationRepository } from './infrastructure/notification.repository';

@Module({
  imports: [PrismaModule],
  providers: [NotificationRepository],
  exports: [NotificationRepository],
})
export class NotificationsModule {}

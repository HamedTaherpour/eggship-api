import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AdminAnalyticsController } from './api/admin-analytics.controller';
import { AnalyticsService } from './application/analytics.service';
import { AnalyticsRepository } from './infrastructure/analytics.repository';

@Module({
  imports: [PrismaModule, forwardRef(() => AuthModule)],
  controllers: [AdminAnalyticsController],
  providers: [AnalyticsRepository, AnalyticsService],
})
export class AnalyticsModule {}

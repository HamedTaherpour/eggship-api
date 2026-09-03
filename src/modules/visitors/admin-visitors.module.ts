import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AdminVisitorsController } from './api/admin-visitors.controller';
import { AdminVisitorService } from './application/admin-visitor.service';
import { VisitorsModule } from './visitors.module';

/** Admin read surface kept separate from referral persistence/Auth composition. */
@Module({
  imports: [PrismaModule, AuthModule, VisitorsModule],
  controllers: [AdminVisitorsController],
  providers: [AdminVisitorService],
})
export class AdminVisitorsModule {}

import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { AdminSettlementsController } from './api/admin-settlements.controller';
import { SettlementService } from './application/settlement.service';
import { SettlementRepository } from './infrastructure/settlement.repository';

@Module({
  imports: [PrismaModule, MediaModule, forwardRef(() => AuthModule)],
  controllers: [AdminSettlementsController],
  providers: [SettlementRepository, SettlementService],
  exports: [SettlementService],
})
export class SettlementsModule {}

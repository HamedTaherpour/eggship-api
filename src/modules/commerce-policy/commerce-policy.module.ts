import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AdminCommercePolicyController } from './api/admin-commerce-policy.controller';
import { CommercePolicyService } from './application/commerce-policy.service';
import { CommercePolicyRepository } from './infrastructure/commerce-policy.repository';

@Module({
  imports: [PrismaModule, forwardRef(() => AuthModule)],
  controllers: [AdminCommercePolicyController],
  providers: [CommercePolicyRepository, CommercePolicyService],
  exports: [CommercePolicyService],
})
export class CommercePolicyModule {}

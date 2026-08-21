import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AdminRegionsController } from './api/admin-regions.controller';
import { RegionsController } from './api/regions.controller';
import { RegionService } from './application/region.service';
import { RegionRepository } from './infrastructure/region.repository';

/**
 * Region reference resource (CAT-02).
 * Independent of profile/shipping domains; no premature FK coupling.
 * AuthModule is imported only so Admin routes can resolve AccessTokenGuard.
 */
@Module({
  imports: [PrismaModule, forwardRef(() => AuthModule)],
  controllers: [RegionsController, AdminRegionsController],
  providers: [RegionRepository, RegionService],
  exports: [RegionService],
})
export class RegionsModule {}

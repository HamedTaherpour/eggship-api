import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminsModule } from './admins.module';
import { AdminManagementController } from './api/admin-management.controller';

/** Permissioned Admin account-management HTTP surface. */
@Module({
  imports: [AdminsModule, AuthModule],
  controllers: [AdminManagementController],
})
export class AdminManagementModule {}

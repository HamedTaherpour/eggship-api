import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from './audit.module';
import { AdminAuditLogsController } from './api/admin-audit-logs.controller';

/** Admin HTTP adapter for AuditLog; the core AuditModule stays infrastructure-only. */
@Module({
  imports: [AuditModule, forwardRef(() => AuthModule)],
  controllers: [AdminAuditLogsController],
})
export class AdminAuditModule {}

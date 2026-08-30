import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AuditLogService } from './application/audit-log.service';
import { AuditLogRepository } from './infrastructure/audit-log.repository';

@Module({
  imports: [PrismaModule],
  providers: [AuditLogRepository, AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}

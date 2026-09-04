import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AsyncRecoveryRepository } from './infrastructure/async-recovery.repository';
import { AsyncRecoveryService } from './application/async-recovery.service';
import { AdminAsyncFailuresController } from './api/admin-async-failures.controller';
import { RECOVERY_PROCESSORS } from './domain/async-recovery';
import { AuthModule } from '../auth/auth.module';
import { QueueInfrastructureModule } from '../../infrastructure/queue/queue-infrastructure.module';
import { ReplayDispatcher } from './application/replay-dispatcher';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    QueueInfrastructureModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [AdminAsyncFailuresController],
  providers: [
    AsyncRecoveryRepository,
    AsyncRecoveryService,
    ReplayDispatcher,
    { provide: RECOVERY_PROCESSORS, useValue: [] },
  ],
  exports: [AsyncRecoveryService, ReplayDispatcher],
})
export class AsyncRecoveryModule {}

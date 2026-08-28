import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { OutboxPublisher } from './application/outbox-publisher';
import { PrismaOutboxPublisher } from './infrastructure/prisma-outbox-publisher';
import { QueueInfrastructureModule } from '../../infrastructure/queue/queue-infrastructure.module';
import { OutboxDispatcher } from './application/outbox-dispatcher';

@Module({
  imports: [PrismaModule, QueueInfrastructureModule],
  providers: [
    PrismaOutboxPublisher,
    OutboxDispatcher,
    { provide: OutboxPublisher, useExisting: PrismaOutboxPublisher },
  ],
  exports: [OutboxPublisher, OutboxDispatcher],
})
export class OutboxModule {}

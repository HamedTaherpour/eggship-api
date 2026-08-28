import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { OutboxPublisher } from './application/outbox-publisher';
import { PrismaOutboxPublisher } from './infrastructure/prisma-outbox-publisher';

@Module({
  imports: [PrismaModule],
  providers: [
    PrismaOutboxPublisher,
    { provide: OutboxPublisher, useExisting: PrismaOutboxPublisher },
  ],
  exports: [OutboxPublisher],
})
export class OutboxModule {}

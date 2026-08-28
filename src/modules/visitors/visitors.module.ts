import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { VisitorRepository } from './infrastructure/visitor.repository';

@Module({
  imports: [PrismaModule],
  providers: [VisitorRepository],
  exports: [VisitorRepository],
})
export class VisitorsModule {}

import { Module } from '@nestjs/common';
import { TransactionRunner } from '../transaction';
import { PrismaService } from './prisma.service';
import { PrismaTransactionRunner } from './prisma-transaction-runner';

@Module({
  providers: [
    PrismaService,
    { provide: TransactionRunner, useClass: PrismaTransactionRunner },
  ],
  exports: [PrismaService, TransactionRunner],
})
export class PrismaModule {}

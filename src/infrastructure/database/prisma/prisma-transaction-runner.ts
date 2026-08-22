import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from './prisma.service';
import { PrismaTransactionContext } from './prisma-transaction-context';
import { TransactionRunner, type TransactionContext } from '../transaction';

@Injectable()
export class PrismaTransactionRunner extends TransactionRunner {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  override run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (client) => {
      return fn(new PrismaTransactionContext(client));
    });
  }

  override runIn<T>(
    existing: TransactionContext | undefined,
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    if (existing !== undefined) {
      return fn(existing);
    }
    return this.run(fn);
  }

  override runSnapshotRead<T>(
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (client) => fn(new PrismaTransactionContext(client)),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  override runRepeatableRead<T>(
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (client) => fn(new PrismaTransactionContext(client)),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
